import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCBSiWbOik2ksVyKcGOjb0_UYrIozyCTN0",
  authDomain: "pulse-b1a30.firebaseapp.com",
  projectId: "pulse-b1a30",
  storageBucket: "pulse-b1a30.firebasestorage.app",
  messagingSenderId: "132301633320",
  appId: "1:132301633320:web:a26589c3e86831645fc21d"
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    console.error("Failed to initialize firebase", e);
}

// Export specific instances
export { app, auth, db };