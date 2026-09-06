/* An in-memory stand-in for the parts of Firebase Auth and Firestore that
   js/cloud.js uses.

   It exists so the sync layer can be tested at all: there is no Firebase
   project in this repo, and a test that needs the network is not a test. One
   instance is a *backend*, so pointing two jsdom pages at the same instance
   models two phones sharing one account — which is the whole feature.

   It is deliberately strict about isolation: reads and writes are addressed
   from schools/{uid}, so a bug that reached across accounts would show up
   here as data appearing where it should not. */

'use strict';

function createBackend() {
  var users = {};        // email -> { uid, password }
  var docs = {};         // "schools/uid/students/id" -> data
  var listeners = [];
  var nextUid = 1;

  function pathOf(parts) { return parts.join('/'); }

  /* Real snapshots arrive on a later turn, never inside the write that caused
     them. Modelling that matters: firing synchronously would hide re-entrancy
     bugs that only show up against the real thing. */
  function notify(prefix) {
    listeners.slice().forEach(function (listener) {
      if (prefix.indexOf(listener.prefix) === 0 || listener.prefix.indexOf(prefix) === 0) {
        setTimeout(function () { listener.fire(); }, 0);
      }
    });
  }

  /* ------------------------------------------------------------- firestore */

  function docRef(parts) {
    var path = pathOf(parts);
    return {
      _path: path,
      id: parts[parts.length - 1],

      set: function (data, options) {
        var merged = options && options.merge && docs[path]
          ? Object.assign({}, docs[path], data)
          : JSON.parse(JSON.stringify(data));
        docs[path] = merged;
        notify(path);
        return Promise.resolve();
      },

      get: function () {
        var data = docs[path];
        return Promise.resolve({
          exists: data !== undefined,
          id: parts[parts.length - 1],
          data: function () { return data ? JSON.parse(JSON.stringify(data)) : undefined; }
        });
      },

      collection: function (name) { return collectionRef(parts.concat([name])); }
    };
  }

  function collectionRef(parts) {
    var prefix = pathOf(parts) + '/';
    return {
      _prefix: prefix,
      doc: function (id) { return docRef(parts.concat([String(id)])); },

      get: function () {
        var rows = Object.keys(docs)
          .filter(function (path) {
            // Direct children only — not documents in deeper subcollections.
            return path.indexOf(prefix) === 0 && path.slice(prefix.length).indexOf('/') === -1;
          })
          .map(function (path) {
            return {
              id: path.slice(prefix.length),
              data: function () { return JSON.parse(JSON.stringify(docs[path])); }
            };
          });

        return Promise.resolve({
          forEach: function (fn) { rows.forEach(fn); },
          size: rows.length
        });
      },

      onSnapshot: function (onNext) {
        var listener = { prefix: prefix, fire: function () { onNext({}); } };
        listeners.push(listener);
        return function () {
          var at = listeners.indexOf(listener);
          if (at !== -1) listeners.splice(at, 1);
        };
      }
    };
  }

  var firestore = {
    collection: function (name) { return collectionRef([name]); },
    enablePersistence: function () { return Promise.resolve(); },
    batch: function () {
      var operations = [];
      return {
        set: function (ref, data) { operations.push({ ref: ref, data: data }); },
        delete: function (ref) { operations.push({ ref: ref, remove: true }); },
        commit: function () {
          var touched = {};
          operations.forEach(function (operation) {
            if (operation.remove) delete docs[operation.ref._path];
            else docs[operation.ref._path] = JSON.parse(JSON.stringify(operation.data));
            touched[operation.ref._path] = true;
          });
          Object.keys(touched).forEach(notify);
          return Promise.resolve();
        }
      };
    }
  };

  /* ------------------------------------------------------------------ auth */

  function authError(code) {
    var err = new Error(code);
    err.code = code;
    return Promise.reject(err);
  }

  var currentUser = null;

  var auth = {
    get currentUser() { return currentUser; },

    createUserWithEmailAndPassword: function (email, password) {
      if (users[email]) return authError('auth/email-already-in-use');
      if (!password || password.length < 6) return authError('auth/weak-password');
      var uid = 'uid_' + (nextUid++);
      users[email] = { uid: uid, password: password };
      currentUser = { uid: uid, email: email };
      return Promise.resolve({ user: currentUser });
    },

    signInWithEmailAndPassword: function (email, password) {
      var user = users[email];
      if (!user) return authError('auth/user-not-found');
      if (user.password !== password) return authError('auth/wrong-password');
      currentUser = { uid: user.uid, email: email };
      return Promise.resolve({ user: currentUser });
    },

    signOut: function () { currentUser = null; return Promise.resolve(); }
  };

  var firebase = {
    apps: [],
    initializeApp: function (config) {
      var app = { options: config, name: '[DEFAULT]' };
      firebase.apps.push(app);
      return app;
    },
    app: function () { return firebase.apps[0]; },
    auth: function () { return auth; },
    firestore: function () { return firestore; }
  };

  return {
    firebase: firebase,

    /* ---- inspection, for assertions ---- */
    users: function () { return Object.keys(users); },
    uidFor: function (email) { return users[email] ? users[email].uid : null; },
    docs: function () { return JSON.parse(JSON.stringify(docs)); },

    /** Document ids directly under schools/{uid}/{name}. */
    childrenOf: function (uid, name) {
      var prefix = 'schools/' + uid + '/' + name + '/';
      return Object.keys(docs)
        .filter(function (path) { return path.indexOf(prefix) === 0; })
        .map(function (path) { return path.slice(prefix.length); })
        .sort();
    },

    read: function (path) { return docs[path]; },

    /** Simulate a change made by some other device. */
    writeDirect: function (path, data) {
      docs[path] = data;
      notify(path);
    },

    listenerCount: function () { return listeners.length; }
  };
}

module.exports = { createBackend: createBackend };
