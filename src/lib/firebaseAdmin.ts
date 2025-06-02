
import admin from 'firebase-admin';

// Ensure your Firebase project ID is set (e.g., via an environment variable)
// For local development, you might need to set GOOGLE_APPLICATION_CREDENTIALS
// to point to your service account key JSON file.
// When deployed to Firebase (e.g., Functions), it initializes automatically.

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      // If GOOGLE_APPLICATION_CREDENTIALS is set, it uses that.
      // Otherwise, if deployed to Firebase, it uses default credentials.
      // You might provide credential explicitly if needed:
      // credential: admin.credential.cert(require('./path/to/your/serviceAccountKey.json'))
    });
    console.log('Firebase Admin SDK initialized.');
  } catch (error) {
    console.error('Firebase Admin SDK initialization error:', error);
    // If using a service account key and it's not found, this might fail.
    // Fallback initialization if needed, or ensure credentials are set.
    if (process.env.FIREBASE_CONFIG && !process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.NODE_ENV !== 'production') {
        console.log("Attempting to initialize Firebase Admin SDK with default app credentials (common in Firebase Functions).");
         admin.initializeApp(); // Default init for Firebase environments
    } else if (!process.env.FIREBASE_CONFIG && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn("Firebase Admin SDK could not be initialized. Ensure GOOGLE_APPLICATION_CREDENTIALS is set for local development or that the app is running in a Firebase environment.");
    }
  }
}

const firestore = admin.firestore();

export { firestore, admin };
