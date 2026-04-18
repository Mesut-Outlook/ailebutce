// sync-to-firebase.mjs - Firebase sync script (no dotenv needed)
import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc } from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Config - read from .env manually
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
const getEnvVar = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

const firebaseConfig = JSON.parse(getEnvVar('VITE_FIREBASE_CONFIG') || '{}')
const email = getEnvVar('VITE_TEST_USER_EMAIL')
const password = getEnvVar('VITE_TEST_USER_PASSWORD')
const appId = getEnvVar('VITE_APP_ID') || 'aile-butce'

if (!firebaseConfig.apiKey) {
  console.error('❌ Firebase config bulunamadı')
  process.exit(1)
}

console.log(`📧 Email: ${email}`)
console.log(`🔑 App ID: ${appId}`)

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

const dbData = JSON.parse(readFileSync(resolve(__dirname, '../db.json'), 'utf-8'))
console.log(`\n📦 db.json'da ${dbData.length} kayıt:`)
dbData.forEach(b => console.log(`   - ${b.id || b.monthYear}`))

async function main() {
  console.log(`\n🔐 Firebase'e giriş yapılıyor...`)
  const cred = await signInWithEmailAndPassword(auth, email, password)
  const userId = cred.user.uid
  console.log(`✅ Giriş OK! UID: ${userId}`)

  const collectionPath = `artifacts/${appId}/users/${userId}/budgets`
  console.log(`\n📤 Yazılıyor → ${collectionPath}`)

  for (const record of dbData) {
    const id = record.id || record.monthYear
    if (!id) { console.warn('⚠️ ID yok, atlanıyor'); continue }
    const docRef = doc(db, collectionPath, id)
    await setDoc(docRef, { ...record, id, monthYear: id })
    console.log(`   ✅ ${id}`)
  }

  console.log(`\n🎉 ${dbData.length} kayıt Firebase Firestore'a yazıldı!`)
  process.exit(0)
}

main().catch(err => {
  console.error('\n❌ Hata:', err.message || err)
  process.exit(1)
})
