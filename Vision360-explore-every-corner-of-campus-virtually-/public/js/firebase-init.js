import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyClr1OrQOHUx6GznJEHoCBIh2bXbF7CNtU",
    authDomain: "virtualcampusexplorer.firebaseapp.com",
    projectId: "virtualcampusexplorer",
    storageBucket: "virtualcampusexplorer.firebasestorage.app",
    messagingSenderId: "972342141922",
    appId: "1:972342141922:web:e618d4fd02d54231ae0fbb",
    measurementId: "G-W56Q6CDXV4"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };