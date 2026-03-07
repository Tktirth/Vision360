import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {

    // ── Type helpers ──────────────────────────────────────────────
    const knownTypes  = new Set(['building', 'department', 'classroom', 'lab']);
    const typeLabels  = { building: 'Main Campus', department: 'Department', classroom: 'Classroom', lab: 'Lab' };
    const typeIcons   = { building: '🏫', department: '🏛️', classroom: '🚪', lab: '🔬' };
    const typeColors  = { building: 'var(--c-primary)', department: 'var(--c-secondary)', classroom: '#a78bfa', lab: '#f093fb' };

    function inferType(s) {
        const raw = (s.sceneType || '').toLowerCase().trim();
        if (knownTypes.has(raw)) return raw;
        const t = (s.title || '').toLowerCase();
        if (t.includes('campus') || t.includes('main'))                  return 'building';
        if (t.includes('department') || t.includes('dept'))              return 'department';
        if (t.includes('lab') || t.includes('laboratory'))               return 'lab';
        if (t.includes('room') || t.includes('class') || t.includes('hall')) return 'classroom';
        return 'building';
    }

    // ── State ──────────────────────────────────────────────────────
    let VIEWER           = null;
    let scenesData       = {};
    let autoRotateActive = false;
    let autoRotateTimer  = null;
    let tourActive       = false;
    let tourTimer        = null;
    let tourIndex        = 0;
    let tourSequence     = [];

    // ── Element refs ───────────────────────────────────────────────
    const overlay    = document.getElementById("loading-overlay");
    const progressBar= document.getElementById("load-progress-bar");
    const titleEl    = document.getElementById("current-scene-title");
    const typeEl     = document.getElementById("current-scene-type");
    const breadEl    = document.getElementById("viewer-breadcrumb");
    const panel      = document.getElementById("scenes-panel");
    const panelList  = document.getElementById("panel-scene-list");
    const toggleBtn  = document.getElementById("toggle-panel-btn");
    const fsBtn      = document.getElementById("btn-fullscreen");
    const ziBtn      = document.getElementById("btn-zoom-in");
    const zoBtn      = document.getElementById("btn-zoom-out");
    const resetBtn   = document.getElementById("btn-reset");
    const autoBtn    = document.getElementById("btn-auto-rotate");
    const infoModal  = document.getElementById("hotspot-info-modal");
    const modalClose = document.getElementById("modal-close-btn");
    const infoPanel  = document.getElementById("scene-info-panel");
    const tourOverlay= document.getElementById("tour-overlay");
    const tourBtn    = document.getElementById("btn-start-tour");
    const tourStop   = document.getElementById("tour-stop-btn");
    const tourNext   = document.getElementById("tour-next-btn");
    const tourPrev   = document.getElementById("tour-prev-btn");

    // ── Progress bar ───────────────────────────────────────────────
    function startProgress() {
        if (!progressBar) return null;
        let w = 0;
        progressBar.style.width = '0%'; progressBar.style.opacity = '1';
        const iv = setInterval(() => { w = Math.min(w + Math.random() * 8, 85); progressBar.style.width = w + '%'; }, 120);
        return iv;
    }
    function finishProgress(iv) {
        if (!progressBar) return;
        clearInterval(iv);
        progressBar.style.width = '100%';
        setTimeout(() => { progressBar.style.opacity = '0'; }, 400);
    }

    try {
        const urlParams    = new URLSearchParams(window.location.search);
        const initialScene = urlParams.get("scene");
        const startTour    = urlParams.get("tour") === "1";

        const loadIv = startProgress();

        // Fetch all scenes
        const snap = await getDocs(collection(db, "scenes"));
        snap.forEach(doc => {
            const d = doc.data();
            d.sceneType = inferType({ ...d, id: doc.id });
            scenesData[doc.id] = d;
        });

        if (Object.keys(scenesData).length === 0) {
            overlay.innerHTML = `<i class="fas fa-cube" style="font-size:2.5rem;color:var(--text-faint);margin-bottom:20px;"></i><p>No scenes available yet.</p>`;
            finishProgress(loadIv);
            return;
        }

        const startId = (initialScene && scenesData[initialScene]) ? initialScene : Object.keys(scenesData)[0];

        // ── Process scenes — attach info hotspot handlers ──────────
        const processed = {};
        Object.entries(scenesData).forEach(([id, scene]) => {
            const s = { ...scene };
            if (s.hotSpots) {
                s.hotSpots = s.hotSpots.map(hs => {
                    if (hs.type === 'info') {
                        return { ...hs, cssClass: 'hs-custom-info', clickHandlerFunc: (e, args) => showInfoModal(args), clickHandlerArgs: { ...hs } };
                    }
                    return hs;
                });
            }
            processed[id] = s;
        });

        // ── Init Pannellum ──────────────────────────────────────────
        VIEWER = pannellum.viewer("panorama", {
            default: { firstScene: startId, sceneFadeDuration: 1000, autoLoad: true, compass: false, showFullscreenCtrl: false, mouseZoom: true, touchZoom: true, hfov: 100 },
            scenes: processed
        });

        VIEWER.on("load", () => {
            finishProgress(loadIv);
            if (overlay) { overlay.style.opacity = "0"; setTimeout(() => { overlay.style.display = "none"; }, 700); }
            updateSceneUI();
            updateInfoPanel();
            preloadAdjacent(VIEWER.getScene());
            if (startTour) setTimeout(() => beginTour(), 800);
        });

        VIEWER.on("scenechange", (id) => {
            updateSceneUI();
            updateInfoPanel();
            refreshPanelHighlight();
            preloadAdjacent(id);
            stopAutoRotate();
        });

        document.getElementById("panorama").addEventListener("mousedown",  () => { if (!tourActive) stopAutoRotate(); });
        document.getElementById("panorama").addEventListener("touchstart", () => { if (!tourActive) stopAutoRotate(); });

        window.__v360viewer = VIEWER;

        // ── Scene info UI ───────────────────────────────────────────
        function updateSceneUI() {
            const id    = VIEWER.getScene();
            const scene = scenesData[id];
            if (!scene) return;
            if (titleEl) titleEl.textContent = scene.title;
            if (typeEl) {
                typeEl.textContent = `${typeIcons[scene.sceneType] || '🌐'} ${typeLabels[scene.sceneType] || '360°'}`;
                typeEl.style.color = typeColors[scene.sceneType] || 'var(--c-primary)';
            }
            if (breadEl) {
                let crumbs = `<a href="index.html">Home</a><span class="sep">›</span>`;
                if (scene.parentId && scenesData[scene.parentId]) {
                    const p = scenesData[scene.parentId];
                    crumbs += `<span style="cursor:pointer;" onclick="window.__v360viewer.loadScene('${scene.parentId}')">${p.title}</span><span class="sep">›</span>`;
                }
                crumbs += `<span style="color:var(--text-main);">${scene.title}</span>`;
                breadEl.innerHTML = crumbs;
            }
            document.title = `${scene.title} – Vision 360`;
        }

        // ── Floating scene info panel ───────────────────────────────
        function updateInfoPanel() {
            if (!infoPanel) return;
            const id    = VIEWER.getScene();
            const scene = scenesData[id];
            if (!scene) return;

            const col   = typeColors[scene.sceneType] || 'var(--c-primary)';
            const label = typeLabels[scene.sceneType] || 'Scene';
            const icon  = typeIcons[scene.sceneType]  || '🌐';
            const hsCount = (scene.hotSpots || []).length;
            const navCount= (scene.hotSpots || []).filter(h => h.type === 'scene').length;
            const desc  = scene.description || 'No description available. Edit this scene in the Admin Dashboard to add details.';

            // Parent scene name for breadcrumb
            const parentName = (scene.parentId && scenesData[scene.parentId]) ? scenesData[scene.parentId].title : null;

            infoPanel.querySelector('#ip-icon').textContent = icon;
            infoPanel.querySelector('#ip-type').textContent = label;
            infoPanel.querySelector('#ip-type').style.color = col;
            infoPanel.querySelector('#ip-title').textContent = scene.title;
            infoPanel.querySelector('#ip-parent').textContent = parentName ? `📍 ${parentName}` : '📍 Main Campus';
            infoPanel.querySelector('#ip-desc').textContent  = desc;
            infoPanel.querySelector('#ip-hs-count').textContent = hsCount;
            infoPanel.querySelector('#ip-nav-count').textContent = navCount;
            infoPanel.querySelector('#ip-info-count').textContent = hsCount - navCount;
        }

        // ── Preload adjacent scenes ─────────────────────────────────
        function preloadAdjacent(id) {
            const scene = scenesData[id];
            if (!scene?.hotSpots) return;
            scene.hotSpots.forEach(hs => {
                if (hs.type === 'scene' && hs.sceneId && scenesData[hs.sceneId]) {
                    const p = scenesData[hs.sceneId].panorama;
                    if (p) { const img = new Image(); img.src = p.startsWith('images/') ? '/' + p : p; }
                }
            });
        }

        // ── Info hotspot modal ──────────────────────────────────────
        function showInfoModal(hs) {
            if (!infoModal) return;
            document.getElementById('modal-hs-title').textContent = hs.text || 'Info';
            document.getElementById('modal-hs-desc').innerHTML = (hs.description || 'No description provided.').replace(/\n/g, '<br>');
            const imgWrap = document.getElementById('modal-hs-img-wrap');
            const imgEl   = document.getElementById('modal-hs-img');
            if (hs.imageUrl) { imgEl.src = hs.imageUrl; imgWrap.style.display = 'block'; }
            else imgWrap.style.display = 'none';
            infoModal.classList.add('open');
            stopAutoRotate();
        }

        modalClose && modalClose.addEventListener('click', () => infoModal && infoModal.classList.remove('open'));
        infoModal  && infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.remove('open'); });

        // ── Scenes panel ────────────────────────────────────────────
        function buildScenesPanel() {
            if (!panelList) return;
            const typeOrder = { building: 1, department: 2, classroom: 3, lab: 4 };
            const sorted = Object.entries(scenesData).sort(([,a],[,b]) => {
                return (typeOrder[a.sceneType]||5) - (typeOrder[b.sceneType]||5) || (a.title||'').localeCompare(b.title||'');
            });
            panelList.innerHTML = '';
            sorted.forEach(([id, scene]) => {
                const item = document.createElement('div');
                item.className = 'panel-scene-item';
                item.dataset.id = id;
                item.innerHTML = `<div class="panel-scene-dot"></div><div class="panel-scene-name">${scene.title}</div><div class="panel-scene-badge" style="color:${typeColors[scene.sceneType]||'var(--text-faint)'};">${typeLabels[scene.sceneType]||'Scene'}</div>`;
                item.addEventListener('click', () => { VIEWER.loadScene(id); if (window.innerWidth <= 768) panel && panel.classList.remove('open'); });
                panelList.appendChild(item);
            });
        }

        function refreshPanelHighlight() {
            const cur = VIEWER.getScene();
            document.querySelectorAll('.panel-scene-item').forEach(el => el.classList.toggle('current', el.dataset.id === cur));
        }

        buildScenesPanel();

        // ── Panel toggle ────────────────────────────────────────────
        toggleBtn && toggleBtn.addEventListener('click', () => { panel && panel.classList.toggle('open'); toggleBtn.classList.toggle('active'); });

        // ── Info panel toggle ───────────────────────────────────────
        const infoPanelBtn = document.getElementById('btn-info-panel');
        infoPanelBtn && infoPanelBtn.addEventListener('click', () => {
            infoPanel && infoPanel.classList.toggle('open');
            infoPanelBtn.classList.toggle('active');
        });

        // ── Fullscreen ──────────────────────────────────────────────
        fsBtn && fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
                fsBtn.innerHTML = '<i class="fas fa-compress"></i>'; fsBtn.classList.add('active');
            } else {
                document.exitFullscreen && document.exitFullscreen();
                fsBtn.innerHTML = '<i class="fas fa-expand"></i>'; fsBtn.classList.remove('active');
            }
        });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && fsBtn) { fsBtn.innerHTML = '<i class="fas fa-expand"></i>'; fsBtn.classList.remove('active'); }
        });

        // ── Zoom / Reset ────────────────────────────────────────────
        ziBtn    && ziBtn.addEventListener('click',    () => VIEWER.setHfov(Math.max(VIEWER.getHfov() - 15, 30)));
        zoBtn    && zoBtn.addEventListener('click',    () => VIEWER.setHfov(Math.min(VIEWER.getHfov() + 15, 120)));
        resetBtn && resetBtn.addEventListener('click', () => { VIEWER.setHfov(100); VIEWER.setPitch(0); VIEWER.setYaw(0); });

        // ── Auto-rotate ─────────────────────────────────────────────
        function startAutoRotate() {
            if (autoRotateActive) return;
            autoRotateActive = true;
            if (autoBtn) { autoBtn.classList.add('active'); autoBtn.setAttribute('data-tip','Stop Rotation'); }
            autoRotateTimer = setInterval(() => { if (VIEWER) VIEWER.setYaw(VIEWER.getYaw() + 0.25); }, 16);
        }
        function stopAutoRotate() {
            if (!autoRotateActive) return;
            autoRotateActive = false;
            clearInterval(autoRotateTimer);
            if (autoBtn) { autoBtn.classList.remove('active'); autoBtn.setAttribute('data-tip','Auto-Rotate (A)'); }
        }
        autoBtn && autoBtn.addEventListener('click', () => autoRotateActive ? stopAutoRotate() : startAutoRotate());

        // ── GUIDED TOUR ─────────────────────────────────────────────
        function buildTourSequence() {
            const typeOrder = { building: 1, department: 2, classroom: 3, lab: 4 };
            return Object.entries(scenesData)
                .sort(([,a],[,b]) => (typeOrder[a.sceneType]||5) - (typeOrder[b.sceneType]||5) || (a.title||'').localeCompare(b.title||''))
                .map(([id]) => id);
        }

        const TOUR_DURATION = 12; // seconds per stop

        function beginTour() {
            tourSequence = buildTourSequence();
            if (tourSequence.length === 0) return;
            tourActive = true;
            tourIndex  = 0;
            if (tourOverlay) tourOverlay.classList.add('open');
            if (tourBtn) tourBtn.style.display = 'none';
            startAutoRotate();
            loadTourStop(tourIndex);
        }

        function loadTourStop(idx) {
            clearInterval(tourTimer);
            const id = tourSequence[idx];
            if (!id) { endTour(); return; }

            VIEWER.loadScene(id);

            // Update tour overlay content
            const scene = scenesData[id];
            if (tourOverlay) {
                tourOverlay.querySelector('#tour-scene-name').textContent  = scene?.title || 'Scene';
                tourOverlay.querySelector('#tour-scene-type').textContent  = `${typeIcons[scene?.sceneType]||'🌐'} ${typeLabels[scene?.sceneType]||'Scene'}`;
                tourOverlay.querySelector('#tour-scene-desc').textContent  = scene?.description || 'Explore this location in 360°.';
                tourOverlay.querySelector('#tour-stop-num').textContent    = `Stop ${idx + 1} of ${tourSequence.length}`;
                // Progress dots
                const dots = tourOverlay.querySelector('#tour-dots');
                if (dots) {
                    dots.innerHTML = tourSequence.map((_, i) =>
                        `<div class="tour-dot ${i === idx ? 'active' : i < idx ? 'done' : ''}"></div>`
                    ).join('');
                }
            }

            // Countdown
            let remaining = TOUR_DURATION;
            const countEl = tourOverlay?.querySelector('#tour-countdown');
            if (countEl) countEl.textContent = remaining;

            tourTimer = setInterval(() => {
                remaining--;
                if (countEl) countEl.textContent = remaining;
                if (remaining <= 0) {
                    clearInterval(tourTimer);
                    if (tourIndex < tourSequence.length - 1) {
                        tourIndex++;
                        loadTourStop(tourIndex);
                    } else {
                        endTour();
                    }
                }
            }, 1000);
        }

        function endTour() {
            tourActive = false;
            clearInterval(tourTimer);
            if (tourOverlay) tourOverlay.classList.remove('open');
            if (tourBtn) tourBtn.style.display = '';
            stopAutoRotate();
        }

        tourBtn  && tourBtn.addEventListener('click',  () => beginTour());
        tourStop && tourStop.addEventListener('click',  () => endTour());
        tourNext && tourNext.addEventListener('click',  () => { if (tourIndex < tourSequence.length - 1) { tourIndex++; loadTourStop(tourIndex); } else endTour(); });
        tourPrev && tourPrev.addEventListener('click',  () => { if (tourIndex > 0) { tourIndex--; loadTourStop(tourIndex); } });

        // ── Keyboard ────────────────────────────────────────────────
        document.addEventListener('keydown', (e) => {
            if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
            switch(e.key) {
                case 'ArrowUp':    e.preventDefault(); VIEWER.setPitch(VIEWER.getPitch() + 10); break;
                case 'ArrowDown':  e.preventDefault(); VIEWER.setPitch(VIEWER.getPitch() - 10); break;
                case 'ArrowLeft':  e.preventDefault(); VIEWER.setYaw(VIEWER.getYaw() - 15);    break;
                case 'ArrowRight': e.preventDefault(); VIEWER.setYaw(VIEWER.getYaw() + 15);    break;
                case '+': case '=': VIEWER.setHfov(Math.max(VIEWER.getHfov() - 10, 30));  break;
                case '-':           VIEWER.setHfov(Math.min(VIEWER.getHfov() + 10, 120)); break;
                case 'f': case 'F': fsBtn   && fsBtn.click();    break;
                case 'r': case 'R': resetBtn && resetBtn.click(); break;
                case 'a': case 'A': autoBtn  && autoBtn.click();  break;
                case 's': case 'S': toggleBtn && toggleBtn.click(); break;
                case 'i': case 'I': infoPanelBtn && infoPanelBtn.click(); break;
                case 't': case 'T': if (!tourActive) beginTour(); else endTour(); break;
                case 'Escape':
                    endTour();
                    panel   && panel.classList.remove('open');
                    infoPanel && infoPanel.classList.remove('open');
                    infoModal && infoModal.classList.remove('open');
                    break;
            }
        });

    } catch (error) {
        console.error("Viewer initialization failed:", error);
        overlay && (overlay.innerHTML = `
            <i class="fas fa-exclamation-triangle" style="font-size:2.5rem;color:#ff0844;margin-bottom:20px;"></i>
            <p style="color:#ff0844;">Error loading viewer</p>
            <small style="color:var(--text-faint);">${error.message}</small>`);
    }
});