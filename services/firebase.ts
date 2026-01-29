
import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getDatabase, Database } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCD5932zIzf2rFD0LY_Iz4ccBDQu9H8u4s",
  authDomain: "pulse-9d854.firebaseapp.com",
  projectId: "pulse-9d854",
  storageBucket: "pulse-9d854.firebasestorage.app",
  messagingSenderId: "179231908838",
  appId: "1:179231908838:web:f19a5c0bf2945f946d6c27",
  databaseURL: "https://pulse-9d854-default-rtdb.firebaseio.com"
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let rtdb: Database;

try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.error("Failed to initialize Firebase App:", e);
}

if (app!) {
  try {
    auth = getAuth(app);
  } catch (e) {
    console.error("Failed to initialize Auth:", e);
  }

  try {
    db = getFirestore(app);
  } catch (e) {
    console.error("Failed to initialize Firestore:", e);
  }

  try {
    // Explicitly pass the databaseURL to ensure it connects even if config isn't auto-detected
    rtdb = getDatabase(app, firebaseConfig.databaseURL);
  } catch (e) {
    console.error("Failed to initialize Realtime Database. Ensure 'databaseURL' is correct and RTDB is enabled in Firebase Console.", e);
  }
}

// Export specific instances
export { app, auth, db, rtdb };
