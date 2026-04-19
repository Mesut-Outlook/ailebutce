import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8').split('\n');
env.forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) {
    process.env[key.trim()] = rest.join('=').trim();
  }
});

const configStr = process.env.VITE_FIREBASE_CONFIG;
const firebaseConfig = JSON.parse(configStr);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = process.env.VITE_TEST_USER_EMAIL;
const password = process.env.VITE_TEST_USER_PASSWORD;

async function test() {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;
    console.log(`Logged in as ${userId}`);

    const budgetsRef = collection(db, `artifacts/aile-butce/users/${userId}/budgets`);
    const snap = await getDocs(budgetsRef);
    console.log(`Found ${snap.size} budgets in artifacts/aile-butce/users/${userId}/budgets`);
    snap.forEach(doc => console.log(doc.id));

    // Try a simple write
    const testDoc = doc(db, `artifacts/aile-butce/users/${userId}/budgets/test_doc`);
    await setDoc(testDoc, { test: 123 });
    console.log("Successfully wrote test_doc");

    process.exit(0);
  } catch(e) {
    console.error("Test Error:", e);
    process.exit(1);
  }
}

test();
