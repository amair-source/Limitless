import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfigData from '../../firebase-applet-config.json';

// Hardcoded Firebase configuration for production stability
const firebaseConfig = {
  apiKey: "AIzaSyDoynbp6uDsy1wp1_OJ3IXq8X6NtjNAFJk",
  authDomain: "gen-lang-client-0166371823.firebaseapp.com",
  projectId: "gen-lang-client-0166371823",
  storageBucket: "gen-lang-client-0166371823.firebasestorage.app",
  messagingSenderId: "1090219963731",
  appId: "1:1090219963731:web:7e3c665d91333972b0dda6",
  firestoreDatabaseId: "ai-studio-00229b6c-7c5d-417e-9dd5-1c7f83eac006"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error: any) {
    console.error("Firebase Auth Error:", error.code, error.message);
    if (error.code === 'auth/unauthorized-domain') {
      alert(`Domain Unauthorized: Please add "${window.location.hostname}" to your Firebase Console > Authentication > Settings > Authorized domains.`);
    } else {
      alert(`Sign-in failed: ${error.message}`);
    }
    throw error;
  }
};
export const logout = () => signOut(auth);
