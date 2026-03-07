import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile, getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { collection, doc, setDoc, getDocs, updateDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Firebase config (duplicated here for secondary app instance)
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyClr1OrQOHUx6GznJEHoCBIh2bXbF7CNtU",
    authDomain: "virtualcampusexplorer.firebaseapp.com",
    projectId: "virtualcampusexplorer",
    storageBucket: "virtualcampusexplorer.firebasestorage.app",
    messagingSenderId: "972342141922",
    appId: "1:972342141922:web:e618d4fd02d54231ae0fbb"
};

const ADMIN_EMAIL = "admin@vision360.com";

document.addEventListener("DOMContentLoaded", () => {

    // Auth Check
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const isMasterAdmin = (user.email === ADMIN_EMAIL);
            let isAdmin = isMasterAdmin;

            if (!isAdmin) {
                try {
                    const snap = await getDoc(doc(db, "admins", user.email));
                    if (snap.exists()) isAdmin = true;
                } catch (e) { console.error("Admin check error:", e); }
            }

            if (isAdmin) {
                document.getElementById("auth-loading").style.display = "none";
                document.getElementById("dashboard-content").style.display = "flex";
                loadScenesList();

                // Only master admin can see & use the Manage Admins tab
                if (!isMasterAdmin) {
                    // Hide the sidebar link
                    const adminsNavBtn = document.querySelector('[data-target="section-admins"]');
                    if (adminsNavBtn) adminsNavBtn.closest('li').style.display = 'none';
                    // Hide the section itself
                    const adminsSection = document.getElementById('section-admins');
                    if (adminsSection) adminsSection.style.display = 'none';
                } else {
                    loadAdminsList(); // only load for master admin
                }
            } else {
                window.location.href = "login.html";
            }
        } else {
            window.location.href = "login.html";
        }
    });


    document.getElementById("logout-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        await signOut(auth);
    });

    const navBtns = document.querySelectorAll('.nav-btn');
    const tabSections = document.querySelectorAll('.tab-section');
    const sectionTitle = document.getElementById('section-title');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            navBtns.forEach(b => b.classList.remove('active'));
            tabSections.forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.target;
            document.getElementById(targetId).classList.add('active');
            sectionTitle.textContent = btn.textContent.trim();
            if (targetId === 'section-edit' || targetId === 'section-delete') {
                loadScenesList();
            }
            if (targetId === 'section-admins') {
                loadAdminsList();
            }
        });
    });

    // Globals
    window.allScenes = [];
    let editViewer = null;
    let createViewer = null;
    let currentEditingScene = null;

    async function loadScenesList() {
        const editListContainer = document.getElementById("edit-scene-list");
        const deleteListContainer = document.getElementById("delete-scene-list");

        if (editListContainer) editListContainer.innerHTML = '';
        if (deleteListContainer) deleteListContainer.innerHTML = '';

        try {
            const querySnapshot = await getDocs(collection(db, "scenes"));
            window.allScenes = [];

            if (querySnapshot.empty) {
                if (editListContainer) editListContainer.innerHTML = '<li>No scenes found.</li>';
                if (deleteListContainer) deleteListContainer.innerHTML = '<li>No scenes found.</li>';
                updateCreateParentDropdown();
                return;
            }

            querySnapshot.forEach(docSnap => {
                window.allScenes.push({ id: docSnap.id, ...docSnap.data() });
            });

            window.allScenes.forEach((data) => {
                const sceneTypeStr = data.sceneType ? `[${data.sceneType}]` : `[building]`;
                const contentHTML = `
                    <div class="scene-info">
                        <strong>${data.title} ${sceneTypeStr}</strong>
                        <span>ID: ${data.id}</span>
                        <span>Hotspots: ${data.hotSpots ? data.hotSpots.length : 0}</span>
                    </div>
                `;

                if (editListContainer) {
                    const editLi = document.createElement('li');
                    editLi.className = 'scene-item';
                    editLi.innerHTML = contentHTML + `
                        <div class="scene-actions">
                            <button class="edit-btn" data-id="${data.id}" title="Edit Scene"><i class="fas fa-edit"></i></button>
                        </div>
                    `;
                    editListContainer.appendChild(editLi);
                }

                if (deleteListContainer) {
                    const deleteLi = document.createElement('li');
                    deleteLi.className = 'scene-item';
                    deleteLi.innerHTML = contentHTML + `
                        <div class="scene-actions">
                            <button class="delete-btn" data-id="${data.id}" title="Delete Scene"><i class="fas fa-trash"></i></button>
                        </div>
                    `;
                    deleteListContainer.appendChild(deleteLi);
                }
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const sceneId = e.currentTarget.dataset.id;
                    if (confirm(`Are you sure you want to completely delete the scene: "${sceneId}"? Note that the image is still stored on local disk.`)) {
                        try {
                            await deleteDoc(doc(db, "scenes", sceneId));
                            alert(`Scene deleted.`);
                            loadScenesList();
                        } catch (err) { alert(err.message); }
                    }
                });
            });

            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    openEditModal(e.currentTarget.dataset.id);
                });
            });

            // Update hierarchy dropdown for CREATE mode based on new loaded scenes
            updateCreateParentDropdown();

        } catch (error) {
            console.error(error);
        }
    }

    // --- REUSABLE HOTSPOT UI ARCHITECTURE ---

    function buildHotspotEditorRow(hotspot = {}, container, viewerInstance) {
        hotspot = {
            type: hotspot.type || 'scene',
            pitch: hotspot.pitch !== undefined ? hotspot.pitch : 0,
            yaw: hotspot.yaw !== undefined ? hotspot.yaw : 0,
            text: hotspot.text || 'New Hotspot',
            sceneId: hotspot.sceneId || '',
            description: hotspot.description || '',
            imageUrl: hotspot.imageUrl || '',
            ...hotspot
        };

        const div = document.createElement('div');
        div.className = 'hotspot-item';
        div.style.flexWrap = 'wrap';
        const hsId = 'hs_' + Date.now() + Math.random().toString(36).substring(7);
        const isInfo = hotspot.type === 'info';

        let targetOptions = '<option value="">Select Target Scene...</option>';
        window.allScenes.forEach(s => {
            const selected = s.id === hotspot.sceneId ? 'selected' : '';
            targetOptions += `<option value="${s.id}" ${selected}>${s.title} (${s.id})</option>`;
        });

        div.innerHTML = `
            <select class="hs-type" title="Hotspot Type">
                <option value="scene" ${!isInfo ? 'selected' : ''}>🔗 Link to Scene</option>
                <option value="info"  ${ isInfo ? 'selected' : ''}>ℹ️ Info Popup</option>
            </select>
            <input type="number" step="any" class="hs-pitch" placeholder="Pitch" value="${hotspot.pitch}" required style="width:70px" title="Pitch">
            <input type="number" step="any" class="hs-yaw"   placeholder="Yaw"   value="${hotspot.yaw}"   required style="width:70px" title="Yaw">
            <input type="text" class="hs-text" placeholder="Label / Title" value="${hotspot.text}" required style="flex-grow:1;">
            <select class="hs-target" ${isInfo ? 'style="display:none;"' : ''} ${!isInfo ? 'required' : ''} title="Target Scene">
                ${targetOptions}
            </select>
            <button type="button" class="remove-hs-btn" title="Delete Hotspot"><i class="fas fa-trash"></i></button>
            <div class="hs-info-fields" style="width:100%;display:${isInfo ? 'flex' : 'none'};flex-direction:column;gap:8px;margin-top:8px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
                <textarea class="hs-description" placeholder="Description shown in popup (supports multiple lines)" rows="3" style="width:100%;resize:vertical;">${hotspot.description}</textarea>
                <input type="url" class="hs-image-url" placeholder="Optional image URL for popup (https://…)" value="${hotspot.imageUrl || ''}" style="width:100%;">
            </div>
        `;

        const typeSelect    = div.querySelector('.hs-type');
        const targetSelect  = div.querySelector('.hs-target');
        const infoFields    = div.querySelector('.hs-info-fields');

        typeSelect.addEventListener('change', () => {
            const isI = typeSelect.value === 'info';
            targetSelect.style.display = isI ? 'none' : 'inline-block';
            infoFields.style.display   = isI ? 'flex' : 'none';
            if (isI) targetSelect.removeAttribute('required');
            else     targetSelect.setAttribute('required', 'true');
            updateVisualHotspot();
        });

        div.querySelector('.remove-hs-btn').addEventListener('click', () => {
            div.remove();
            if (viewerInstance) {
                try { viewerInstance.removeHotSpot(hsId); } catch (e) { }
            }
        });

        container.appendChild(div);

        const updateVisualHotspot = () => {
            if (!viewerInstance) return;
            const doAdd = () => {
                try { viewerInstance.removeHotSpot(hsId); } catch (e) { }
                try {
                    viewerInstance.addHotSpot({
                        pitch: Number(div.querySelector('.hs-pitch').value) || 0,
                        yaw:   Number(div.querySelector('.hs-yaw').value)   || 0,
                        type:  div.querySelector('.hs-type').value,
                        text:  div.querySelector('.hs-text').value + ' (Click to Details/Delete)',
                        id:    hsId,
                        clickHandlerFunc: function () {
                            if (confirm(`Delete hotspot "${div.querySelector('.hs-text').value}"?`)) {
                                div.remove();
                                try { viewerInstance.removeHotSpot(hsId); } catch (e) { }
                            }
                        }
                    });
                } catch (err) { }
            };
            if (viewerInstance.isLoaded()) doAdd();
            else viewerInstance.on('load', doAdd);
        };

        updateVisualHotspot();
        div.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('change', updateVisualHotspot);
        });
    }

    // --- EDIT SCENE LOGIC ---

    const modal = document.getElementById('edit-modal');
    document.getElementById('close-modal-btn').addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    function openEditModal(sceneId) {
        currentEditingScene = window.allScenes.find(s => s.id === sceneId);
        if (!currentEditingScene) return;

        document.getElementById('edit-modal-title').textContent = `Editing: ${currentEditingScene.title}`;
        document.getElementById('edit-scene-id').value   = sceneId;
        document.getElementById('edit-title').value      = currentEditingScene.title;
        document.getElementById('edit-panorama').value   = '';

        // Scene description (for info panel in viewer)
        const editDesc = document.getElementById('edit-description');
        if (editDesc) editDesc.value = currentEditingScene.description || '';

        const hotspotsContainer = document.getElementById('edit-hotspots-container');
        hotspotsContainer.innerHTML = '';

        let panoramaUrl = currentEditingScene.panorama;
        if (panoramaUrl && panoramaUrl.startsWith('images/')) panoramaUrl = '/' + panoramaUrl;

        if (editViewer) { editViewer.destroy(); editViewer = null; }

        if (panoramaUrl) {
            editViewer = pannellum.viewer('admin-panorama-viewer', {
                type: 'equirectangular', panorama: panoramaUrl, autoLoad: true, showControls: true
            });

            document.getElementById('admin-panorama-viewer').onmousedown = function (e) {
                if (e.shiftKey && editViewer) {
                    const coords = editViewer.mouseEventToCoords(e);
                    buildHotspotEditorRow({ pitch: coords[0].toFixed(2), yaw: coords[1].toFixed(2), text: 'New Target' }, hotspotsContainer, editViewer);
                }
            };
        }

        if (currentEditingScene.hotSpots) {
            currentEditingScene.hotSpots.forEach(hs => buildHotspotEditorRow(hs, hotspotsContainer, editViewer));
        }

        modal.style.display = 'flex';
    }

    document.getElementById('add-hotspot-btn').addEventListener('click', () => {
        buildHotspotEditorRow({}, document.getElementById('edit-hotspots-container'), editViewer);
    });

    document.getElementById('edit-scene-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Saving...'; submitBtn.disabled = true;

        try {
            const sceneId = document.getElementById('edit-scene-id').value;
            const updates = {
                title:       document.getElementById('edit-title').value,
                description: document.getElementById('edit-description')?.value || ''
            };

            const fileInput = document.getElementById('edit-panorama');
            if (fileInput.files.length > 0) {
                updates.panorama = await uploadImage(fileInput);
            }

            const newHotspots = [];
            document.querySelectorAll('#edit-hotspots-container .hotspot-item').forEach(item => {
                const hs = {
                    type:    item.querySelector('.hs-type').value,
                    pitch:   Number(item.querySelector('.hs-pitch').value),
                    yaw:     Number(item.querySelector('.hs-yaw').value),
                    text:    item.querySelector('.hs-text').value,
                    sceneId: item.querySelector('.hs-target').value || ''
                };
                if (hs.type === 'info') {
                    hs.description = item.querySelector('.hs-description')?.value || '';
                    hs.imageUrl    = item.querySelector('.hs-image-url')?.value   || '';
                }
                newHotspots.push(hs);
            });
            updates.hotSpots = newHotspots;

            await updateDoc(doc(db, "scenes", sceneId), updates);
            alert("Scene updated successfully!");
            modal.style.display = 'none';
            loadScenesList();
        } catch (error) {
            alert("Failed to update: " + error.message);
        } finally {
            submitBtn.textContent = 'Save Changes'; submitBtn.disabled = false;
        }
    });

    // --- UNIFIED CREATE SCENE LOGIC ---

    const createLevel = document.getElementById('create-level');
    const createParentGroup = document.getElementById('create-parent-group');
    const createParent = document.getElementById('create-parent');
    const createParentLabel = document.getElementById('create-parent-label');
    const createPanoramaInput = document.getElementById('create-panorama');
    const createPreviewWrapper = document.getElementById('create-preview-wrapper');
    const createHotspotsContainer = document.getElementById('create-hotspots-container');

    createLevel.addEventListener('change', updateCreateParentDropdown);

    function updateCreateParentDropdown() {
        const level = createLevel.value;
        if (level === 'building') {
            createParentGroup.style.display = 'none';
            createParent.removeAttribute('required');
        } else {
            createParentGroup.style.display = 'block';
            createParent.setAttribute('required', 'true');
            if (level === 'department') createParentLabel.textContent = "Select Parent Building";
            if (level === 'classroom') createParentLabel.textContent = "Select Parent Department";

            createParent.innerHTML = '<option value="">-- Select Parent --</option>';

            const expectedParentType = level === 'department' ? 'building' : 'department';

            window.allScenes.forEach(s => {
                const sType = s.sceneType || 'building'; // default old scenes without a type to building
                if (sType === expectedParentType) {
                    createParent.innerHTML += `<option value="${s.id}">${s.title} (${s.id})</option>`;
                }
            });
        }
    }

    createPanoramaInput.addEventListener('change', (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const objectUrl = URL.createObjectURL(file);

        createPreviewWrapper.style.display = 'block';
        if (createViewer) { createViewer.destroy(); createViewer = null; }
        createHotspotsContainer.innerHTML = ''; // reset hotspots for new image

        createViewer = pannellum.viewer('create-panorama-viewer', {
            type: 'equirectangular', panorama: objectUrl, autoLoad: true, showControls: true
        });

        document.getElementById('create-panorama-viewer').onmousedown = function (ev) {
            if (ev.shiftKey && createViewer) {
                const coords = createViewer.mouseEventToCoords(ev);
                buildHotspotEditorRow({ pitch: coords[0].toFixed(2), yaw: coords[1].toFixed(2), text: 'New Target' }, createHotspotsContainer, createViewer);
            }
        };
    });

    document.getElementById('create-add-hotspot-btn').addEventListener('click', () => {
        buildHotspotEditorRow({}, createHotspotsContainer, createViewer);
    });

    document.getElementById('create-scene-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Uploading...'; submitBtn.disabled = true;

        try {
            const url = await uploadImage(createPanoramaInput);
            const sceneId = document.getElementById('create-id').value;

            const newHotspots = [];
            document.querySelectorAll('#create-hotspots-container .hotspot-item').forEach(item => {
                const hs = {
                    type:    item.querySelector('.hs-type').value,
                    pitch:   Number(item.querySelector('.hs-pitch').value),
                    yaw:     Number(item.querySelector('.hs-yaw').value),
                    text:    item.querySelector('.hs-text').value,
                    sceneId: item.querySelector('.hs-target').value || ''
                };
                if (hs.type === 'info') {
                    hs.description = item.querySelector('.hs-description')?.value || '';
                    hs.imageUrl    = item.querySelector('.hs-image-url')?.value   || '';
                }
                newHotspots.push(hs);
            });

            const data = {
                title:       document.getElementById('create-title').value,
                description: document.getElementById('create-description')?.value || '',
                type: 'equirectangular',
                panorama: url,
                sceneType: createLevel.value,
                parentId: createParentGroup.style.display !== 'none' ? createParent.value : null,
                hotSpots: newHotspots
            };

            await setDoc(doc(db, "scenes", sceneId), data);
            alert(`Created Scene ${sceneId}! Note: If you want the parent scene to link here, please go Edit the parent scene.`);

            e.target.reset();
            createHotspotsContainer.innerHTML = '';
            createPreviewWrapper.style.display = 'none';
            if (createViewer) { createViewer.destroy(); createViewer = null; }
            loadScenesList();
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            submitBtn.textContent = 'Create Scene'; submitBtn.disabled = false;
        }
    });

    // --- MANAGE ADMINS LOGIC ---
    async function loadAdminsList() {
        const adminListContainer = document.getElementById("admins-list");
        if (!adminListContainer) return;

        adminListContainer.innerHTML = '';

        // Add master admin visually manually
        const masterLi = document.createElement('li');
        masterLi.className = 'scene-item';
        masterLi.innerHTML = `
            <div class="scene-info">
                <strong>${ADMIN_EMAIL}</strong>
                <span>Master Admin (Cannot be deleted)</span>
            </div>
        `;
        adminListContainer.appendChild(masterLi);

        try {
            const querySnapshot = await getDocs(collection(db, "admins"));
            querySnapshot.forEach(docSnap => {
                const email = docSnap.id;
                const li = document.createElement('li');
                li.className = 'scene-item';
                li.innerHTML = `
                    <div class="scene-info">
                        <strong>${email}</strong>
                        <span>Authorized Co-Admin</span>
                    </div>
                    <div class="scene-actions">
                        <button class="delete-admin-btn" data-email="${email}" title="Revoke Access"><i class="fas fa-trash"></i></button>
                    </div>
                `;
                adminListContainer.appendChild(li);
            });

            document.querySelectorAll('.delete-admin-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const email = e.currentTarget.dataset.email;
                    if (confirm(`Revoke admin access for ${email}? They will no longer be able to access the dashboard.`)) {
                        try {
                            await deleteDoc(doc(db, 'admins', email));
                            alert(`Access revoked for ${email}.`);
                            loadAdminsList();
                        } catch (err) { alert('Error: ' + err.message); }
                    }
                });
            });
        } catch (error) {
            console.error('Error loading admins', error);
        }
    }

    const addAdminForm = document.getElementById('add-admin-form');
    if (addAdminForm) {
        addAdminForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nameInput = document.getElementById('new-admin-name');
            const emailInput = document.getElementById('new-admin-email');
            const passInput = document.getElementById('new-admin-password');
            const confirmInput = document.getElementById('new-admin-confirm');
            const errorDiv = document.getElementById('admin-form-error');

            const newEmail = emailInput.value.toLowerCase().trim();
            const password = passInput.value;
            const confirmPwd = confirmInput.value;
            const displayName = nameInput ? nameInput.value.trim() : '';

            // Client-side validation
            errorDiv.style.display = 'none';
            if (!newEmail || !password) return;
            if (password !== confirmPwd) {
                errorDiv.textContent = 'Passwords do not match.';
                errorDiv.style.display = 'block';
                return;
            }
            if (password.length < 6) {
                errorDiv.textContent = 'Password must be at least 6 characters.';
                errorDiv.style.display = 'block';
                return;
            }

            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
            submitBtn.disabled = true;

            let secondaryApp = null;
            try {
                // Use a secondary Firebase app so the CURRENT admin session is never touched
                secondaryApp = initializeApp(FIREBASE_CONFIG, `admin-create-${Date.now()}`);
                const secondaryAuth = getAuth(secondaryApp);

                // Create the new Firebase Auth account
                const userCred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, password);

                // Set display name if provided
                if (displayName) {
                    await updateProfile(userCred.user, { displayName });
                }

                // Immediately sign out the secondary auth (we don't need it logged in)
                await secondaryAuth.signOut();

                // Store in Firestore /admins/<email>
                await setDoc(doc(db, 'admins', newEmail), {
                    uid: userCred.user.uid,
                    role: 'admin',
                    addedAt: new Date().toISOString(),
                    displayName: displayName || newEmail.split('@')[0]
                });

                // Clean up secondary app
                await deleteApp(secondaryApp);
                secondaryApp = null;

                e.target.reset();
                errorDiv.style.display = 'none';
                alert(`✅ Admin account created for ${newEmail}\nThey can now log in with the password you set.`);
                loadAdminsList();

            } catch (error) {
                if (secondaryApp) {
                    try { await deleteApp(secondaryApp); } catch (_) { }
                }
                let msg = error.message;
                if (error.code === 'auth/email-already-in-use') {
                    msg = `An account for ${newEmail} already exists. Try a different email, or go to Firebase Console to reset their password.`;
                }
                errorDiv.textContent = msg;
                errorDiv.style.display = 'block';
            } finally {
                submitBtn.innerHTML = '<i class="fas fa-user-check"></i> Create Admin Account';
                submitBtn.disabled = false;
            }
        });
    }

    // Helper
    async function uploadImage(fileInput) {
        if (!fileInput.files || fileInput.files.length === 0) throw new Error("No image selected");
        const formData = new FormData();
        formData.append("panorama", fileInput.files[0]);

        try {
            // Ensure we strictly hit the local node server running on port 3000
            const response = await fetch("http://localhost:3000/upload", { method: "POST", body: formData });
            if (!response.ok) throw new Error("Upload failed (Check if Node.js server is running)");
            const data = await response.json();
            return data.url;
        } catch (error) {
            console.error("Upload API Error:", error);
            throw new Error(`Failed to upload image. Please verify that your Node.js upload backend is running on port 3000. Setup error Details: ${error.message}`);
        }
    }

});
