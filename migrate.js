import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';

// simple .env parser
const env = fs.readFileSync('.env', 'utf8').split('\n');
env.forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) {
    process.env[key.trim()] = rest.join('=').trim();
  }
});

const configStr = process.env.VITE_FIREBASE_CONFIG;
if (!configStr) {
  console.error("VITE_FIREBASE_CONFIG is missing!");
  process.exit(1);
}

const firebaseConfig = JSON.parse(configStr);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = process.env.VITE_TEST_USER_EMAIL;
const password = process.env.VITE_TEST_USER_PASSWORD;

async function migrate() {
  try {
    console.log(`Logging in with ${email}...`);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;
    console.log(`Logged in successfully. User UID: ${userId}`);

    const raw = fs.readFileSync('db.json', 'utf8');
    const records = JSON.parse(raw);

    let successCount = 0;
    for (const record of records) {
      const docRef = doc(db, `users/${userId}/budgets`, record.id);
      await setDoc(docRef, record);
      console.log(`✅ Uploaded budget for: ${record.id}`);
      successCount++;
    }
    console.log(`🎉 Successfully migrated ${successCount} records to Firebase Firestore!`);
    process.exit(0);
  } catch(e) {
    console.error("Migration Error:", e);
    process.exit(1);
  }
}

migrate();
