import fs from 'fs';

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
const apiKey = firebaseConfig.apiKey;
const projectId = firebaseConfig.projectId;
const email = process.env.VITE_TEST_USER_EMAIL;
const password = process.env.VITE_TEST_USER_PASSWORD;

function toFirestoreType(value) {
    if (value === null) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return { integerValue: value.toString() };
        return { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreType) } };
    if (typeof value === 'object') {
        const fields = {};
        for (const [k, v] of Object.entries(value)) {
            fields[k] = toFirestoreType(v);
        }
        return { mapValue: { fields } };
    }
}

function toFirestoreDocument(obj) {
    const doc = toFirestoreType(obj);
    return { fields: doc.mapValue.fields };
}

async function migrate() {
  try {
    console.log(`Logging in with ${email}...`);
    const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    
    if (!authRes.ok) {
        const err = await authRes.json();
        throw new Error(err.error.message);
    }
    const authData = await authRes.json();
    const idToken = authData.idToken;
    const userId = authData.localId;
    console.log(`Logged in successfully. User UID: ${userId}`);

    const raw = fs.readFileSync('db.json', 'utf8');
    const records = JSON.parse(raw);

    let successCount = 0;
    for (const record of records) {
      const docPath = `users/${userId}/budgets/${record.id}`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?key=${apiKey}`;
      const payload = toFirestoreDocument(record);
      
      const res = await fetch(url, {
          method: 'PATCH', // PATCH creates or updates using firestore semantics
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify(payload)
      });
      if (!res.ok) {
          const resErr = await res.json();
          throw new Error('Firestore Error: ' + JSON.stringify(resErr));
      }
      console.log(`✅ Uploaded budget for: ${record.id}`);
      successCount++;
    }
    console.log(`🎉 Successfully migrated ${successCount} records to Firebase Firestore!`);
    process.exit(0);
  } catch(e) {
    console.error("Migration Error:", e.message);
    process.exit(1);
  }
}

migrate();
