import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot,
  getDocFromServer
} from 'firebase/firestore';
// [Fase 1 · Modul 4.4 / Secret-hygiejne · Track F firebase-cleanup 2026-07-20]
// Config læses fra Vite env-vars — ingen hardcoded key i repo.
// Local dev: .env  ·  Production: Vercel env-vars.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DB_ID as string | undefined,
};

// Detect if we are using the real configured Firebase, or the mock/placeholder configuration
export const isRealFirebase =
  !!firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "MOCK_API_KEY_PLACEHOLDER" &&
  !firebaseConfig.apiKey.startsWith("MY_");

let app;
let auth: any;
let db: any;
let googleProvider: any;

if (isRealFirebase) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  } catch (err) {
    console.warn("Error initializing Firebase, falling back to mock services:", err);
  }
}

export { auth, db, googleProvider };

// Connection verification logic
async function testConnection() {
  if (isRealFirebase && db) {
    try {
      await getDocFromServer(doc(db, 'users', 'connection_test_doc'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('offline')) {
        console.error("Please check your Firebase configuration or network status.");
      }
    }
  }
}
testConnection();

// Auth Utility methods
export const logInWithGoogle = async () => {
  if (isRealFirebase && auth && googleProvider) {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } else {
    // Simulated Google Auth for Preview mode
    return {
      uid: 'mock-google-uid-123',
      displayName: 'Aarhus Genbruger',
      email: 'aarhus.genbruger@cirkel.dk',
    } as FirebaseUser;
  }
};

export const registerWithEmail = async (email: string, pass: string) => {
  if (isRealFirebase && auth) {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    return result.user;
  } else {
    return {
      uid: 'mock-email-uid-' + Math.random().toString(36).substr(2, 5),
      displayName: email.split('@')[0],
      email,
    } as FirebaseUser;
  }
};

export const logInWithEmail = async (email: string, pass: string) => {
  if (isRealFirebase && auth) {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    return result.user;
  } else {
    return {
      uid: 'mock-email-uid-logged',
      displayName: email.split('@')[0],
      email,
    } as FirebaseUser;
  }
};

export const logoutUser = async () => {
  if (isRealFirebase && auth) {
    await firebaseSignOut(auth);
  }
};

// Firestore Sync Utilities
export const saveUserProfileToStore = async (userId: string, profileData: any) => {
  if (isRealFirebase && db) {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, profileData, { merge: true });
  }
};

export const fetchUserProfileFromStore = async (userId: string) => {
  if (isRealFirebase && db) {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data();
    }
  }
  return null;
};
