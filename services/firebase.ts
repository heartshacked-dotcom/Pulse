import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCD5932zIzf2rFD0LY_Iz4ccBDQu9H8u4s",
  authDomain: "pulse-9d854.firebaseapp.com",
  projectId: "pulse-9d854",
  storageBucket: "pulse-9d854.firebasestorage.app",
  messagingSenderId: "179231908838",
  appId: "1:179231908838:web:f19a5c0bf2945f946d6c27",
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
