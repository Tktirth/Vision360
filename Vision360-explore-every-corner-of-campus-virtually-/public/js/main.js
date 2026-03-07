import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {
    const cardGrid      = document.getElementById("building-cards-grid");
    const hierarchyView = document.getElementById("hierarchy-view");
    const statScenes    = document.getElementById("stat-scenes");
    const resultsCount  = document.getElementById("results-count");
    const searchInput   = document.getElementById("scene-search");
    const searchClear   = document.getElementById("search-clear-btn");
    const suggestions   = document.getElementById("search-suggestions");
    const btnGrid       = document.getElementById("btn-grid-view");
    const btnTree       = document.getElementById("btn-tree-view");

    let allScenes  = [];
    let activeMode = 'grid';

    // ── Type helpers ──────────────────────────────────────────────
    const knownTypes = new Set(['building', 'department', 'classroom', 'lab']);
    const typeIcons  = { building: '🏫', department: '🏛️', classroom: '🚪', lab: '🔬' };
    const typeLabels = { building: 'Main Campus', department: 'Department', classroom: 'Classroom', lab: 'Lab' };
    const typeBgColors = {
        building:   { icon: 'rgba(0,242,254,0.15)',   border: 'rgba(0,242,254,0.25)',   text: 'var(--c-primary)' },
        department: { icon: 'rgba(79,172,254,0.15)',  border: 'rgba(79,172,254,0.25)',  text: 'var(--c-secondary)' },
        classroom:  { icon: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.25)', text: '#a78bfa' },
        lab:        { icon: 'rgba(240,147,251,0.15)', border: 'rgba(240,147,251,0.25)', text: '#f093fb' },
    };

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

    const typeOrder = { building: 1, department: 2, classroom: 3, lab: 4 };
    function sortScenes(arr) {
        return [...arr].sort((a, b) => {
            const aO = typeOrder[a.sceneType] || 1;
            const bO = typeOrder[b.sceneType] || 1;
            return aO !== bO ? aO - bO : (a.title || '').localeCompare(b.title || '');
        });
    }

    // ── Fetch & boot ──────────────────────────────────────────────
    try {
        const snap = await getDocs(collection(db, "scenes"));
        allScenes = [];
        snap.forEach(doc => allScenes.push({ id: doc.id, ...doc.data() }));
        allScenes.forEach(s => { s.sceneType = inferType(s); });
        allScenes = sortScenes(allScenes);

        if (statScenes) statScenes.textContent = allScenes.length;

        renderGridView(allScenes);
        buildHierarchyView(allScenes);
        updateResultsCount(allScenes.length);

    } catch (err) {
        console.error("Error loading campuses:", err);
        if (cardGrid) cardGrid.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:80px 20px;">
                <i class="fas fa-exclamation-triangle" style="font-size:2.5rem; color:var(--c-danger); margin-bottom:20px; display:block;"></i>
                <p style="color:var(--c-danger);">Failed to load campuses. Please check your connection.</p>
                <small style="color:var(--text-faint);">${err.message}</small>
            </div>`;
    }

    // ═══════════════════════════════════════════════════════════════
    // GRID VIEW
    // ═══════════════════════════════════════════════════════════════
    function renderGridView(scenes) {
        if (!cardGrid) return; // ← null guard

        cardGrid.innerHTML = '';
        if (scenes.length === 0) {
            cardGrid.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:80px 20px;">
                    <i class="fas fa-search" style="font-size:3rem; color:var(--text-faint); margin-bottom:20px; display:block;"></i>
                    <p style="color:var(--text-muted); font-size:1.1rem;">No scenes found. Try a different search.</p>
                </div>`;
            return;
        }

        scenes.forEach((data, idx) => {
            const col  = typeBgColors[data.sceneType] || typeBgColors.building;
            const card = document.createElement("div");
            card.className = "campus-card";
            card.style.animationDelay = `${idx * 0.08}s`;
            const hsCount = data.hotSpots ? data.hotSpots.length : 0;
            card.innerHTML = `
                <div class="card-content">
                    <div class="card-badge" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;background:${col.icon};border:1px solid ${col.border};color:${col.text};">
                        ${typeIcons[data.sceneType] || '🌐'} ${typeLabels[data.sceneType] || 'Scene'}
                    </div>
                    <h3>${data.title}</h3>
                    <p>Explore this immersive 360° panoramic view and navigate through interactive hotspots.</p>
                    <div class="card-footer">
                        <button class="explore-btn" data-id="${data.id}">
                            Explore <i class="fas fa-arrow-right"></i>
                        </button>
                        <div class="card-meta">
                            <i class="fas fa-map-pin"></i>
                            ${hsCount} hotspot${hsCount !== 1 ? 's' : ''}
                        </div>
                    </div>
                </div>`;
            cardGrid.appendChild(card);
        });

        cardGrid.querySelectorAll('.explore-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.location.href = `viewer.html?scene=${btn.dataset.id}`;
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // HIERARCHY TREE VIEW
    // ═══════════════════════════════════════════════════════════════
    function buildHierarchyView(scenes) {
        if (!hierarchyView) return; // ← null guard

        hierarchyView.innerHTML = '';

        const buildings   = scenes.filter(s => s.sceneType === 'building');
        const departments = scenes.filter(s => s.sceneType === 'department');
        const children    = scenes.filter(s => s.sceneType === 'classroom' || s.sceneType === 'lab');

        // ── Main campus rows ──────────────────────────────────────
        buildings.forEach(b => {
            const row = document.createElement('div');
            row.className = 'building-row';
            row.innerHTML = `
                <div style="width:44px;height:44px;background:linear-gradient(135deg,var(--c-primary),var(--c-secondary));border-radius:12px;display:grid;place-items:center;font-size:1.3rem;flex-shrink:0;">🏫</div>
                <div style="flex:1;">
                    <div style="font-weight:700;color:var(--text-main);font-size:1.05rem;">${b.title}</div>
                    <div style="font-size:0.82rem;color:var(--text-muted);">Main Campus · ${b.hotSpots?.length || 0} hotspot${(b.hotSpots?.length||0)!==1?'s':''}</div>
                </div>
                <button class="child-explore" data-id="${b.id}"><i class="fas fa-street-view"></i> Explore</button>`;
            hierarchyView.appendChild(row);
        });

        // ── Department groups ──────────────────────────────────────
        departments.forEach(dept => {
            const linkedViaParent   = children.filter(c => c.parentId === dept.id);
            const linkedViaHotspot  = children.filter(c =>
                !c.parentId && (dept.hotSpots || []).some(hs => hs.sceneId === c.id)
            );
            const deptChildren = [...new Map(
                [...linkedViaParent, ...linkedViaHotspot].map(c => [c.id, c])
            ).values()];

            const group = document.createElement('div');
            group.className = 'dept-group';

            // ── Header ────────────────
            const header = document.createElement('div');
            header.className = 'dept-group-header';
            header.innerHTML = `
                <div class="dept-group-icon"><i class="fas fa-building"></i></div>
                <div class="dept-group-info">
                    <strong>${dept.title}</strong>
                    <span>${deptChildren.length} room${deptChildren.length !== 1 ? 's' : ''} / lab${deptChildren.length !== 1 ? 's' : ''} inside</span>
                </div>
                <button class="child-explore" data-id="${dept.id}" style="margin-right:8px;">
                    <i class="fas fa-eye"></i> View
                </button>
                <i class="fas fa-chevron-down dept-chevron"></i>`;

            // ── Children container (created programmatically — no querySelector needed) ──
            const childContainer = document.createElement('div');
            childContainer.className = 'dept-children';

            if (deptChildren.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:16px;color:var(--text-muted);font-size:0.88rem;text-align:center;';
                empty.innerHTML = '<i class="fas fa-info-circle" style="margin-right:6px;"></i>No rooms or labs linked yet.';
                childContainer.appendChild(empty);
            } else {
                deptChildren.forEach(child => {
                    const childRow = document.createElement('div');
                    childRow.className = 'child-scene-row';
                    const col = typeBgColors[child.sceneType] || typeBgColors.classroom;
                    childRow.innerHTML = `
                        <div class="child-icon ${child.sceneType}">${typeIcons[child.sceneType] || '🌐'}</div>
                        <div class="child-info">
                            <strong>${child.title}</strong>
                            <span>${typeLabels[child.sceneType]} · ${child.hotSpots?.length || 0} hotspot${(child.hotSpots?.length||0)!==1?'s':''}</span>
                        </div>
                        <button class="child-explore" data-id="${child.id}">
                            <i class="fas fa-arrow-right"></i> Explore
                        </button>`;
                    childContainer.appendChild(childRow);
                });
            }

            // Toggle open on header click
            header.addEventListener('click', (e) => {
                if (e.target.closest('.child-explore')) return;
                group.classList.toggle('open');
            });

            group.appendChild(header);
            group.appendChild(childContainer);
            hierarchyView.appendChild(group);
        });

        // ── Orphan children ───────────────────────────────────────
        const linkedIds = new Set([
            ...children.filter(c => c.parentId).map(c => c.id),
            ...departments.flatMap(d => (d.hotSpots || []).map(hs => hs.sceneId))
        ]);
        const orphans = children.filter(c => !linkedIds.has(c.id));

        if (orphans.length > 0) {
            const orphanGroup = document.createElement('div');
            orphanGroup.className = 'dept-group open';

            const orphanHeader = document.createElement('div');
            orphanHeader.className = 'dept-group-header';
            orphanHeader.style.cursor = 'default';
            orphanHeader.innerHTML = `
                <div class="dept-group-icon" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                    <i class="fas fa-layer-group"></i>
                </div>
                <div class="dept-group-info">
                    <strong>Other Spaces</strong>
                    <span>Rooms &amp; Labs not yet linked to a department</span>
                </div>`;

            const orphanContainer = document.createElement('div');
            orphanContainer.className = 'dept-children';
            orphanContainer.style.display = 'flex'; // always open

            orphans.forEach(child => {
                const childRow = document.createElement('div');
                childRow.className = 'child-scene-row';
                childRow.innerHTML = `
                    <div class="child-icon ${child.sceneType}">${typeIcons[child.sceneType] || '🌐'}</div>
                    <div class="child-info">
                        <strong>${child.title}</strong>
                        <span>${typeLabels[child.sceneType]}</span>
                    </div>
                    <button class="child-explore" data-id="${child.id}">
                        <i class="fas fa-arrow-right"></i> Explore
                    </button>`;
                orphanContainer.appendChild(childRow);
            });

            orphanGroup.appendChild(orphanHeader);
            orphanGroup.appendChild(orphanContainer);
            hierarchyView.appendChild(orphanGroup);
        }

        // ── Wire all explore buttons ──────────────────────────────
        hierarchyView.querySelectorAll('.child-explore').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `viewer.html?scene=${btn.dataset.id}`;
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW MODE TOGGLE
    // ═══════════════════════════════════════════════════════════════
    function setViewMode(mode) {
        activeMode = mode;
        if (mode === 'grid') {
            if (cardGrid)      cardGrid.style.display = '';
            if (hierarchyView) hierarchyView.classList.remove('active');
            if (btnGrid) btnGrid.classList.add('active');
            if (btnTree) btnTree.classList.remove('active');
        } else {
            if (cardGrid)      cardGrid.style.display = 'none';
            if (hierarchyView) hierarchyView.classList.add('active');
            if (btnGrid) btnGrid.classList.remove('active');
            if (btnTree) btnTree.classList.add('active');
        }
    }

    btnGrid && btnGrid.addEventListener('click', () => setViewMode('grid'));
    btnTree && btnTree.addEventListener('click', () => setViewMode('tree'));

    // ═══════════════════════════════════════════════════════════════
    // SMART SEARCH
    // ═══════════════════════════════════════════════════════════════
    function updateResultsCount(n, q = '') {
        if (!resultsCount) return;
        resultsCount.innerHTML = q
            ? `<strong>${n}</strong> result${n !== 1 ? 's' : ''} for "<strong>${q}</strong>"`
            : `<strong>${n}</strong> scene${n !== 1 ? 's' : ''} available`;
    }

    function highlight(text, q) {
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) return text;
        return text.slice(0, idx) +
            `<mark style="background:rgba(0,242,254,0.2);color:var(--c-primary);border-radius:3px;padding:0 2px;">${text.slice(idx, idx + q.length)}</mark>` +
            text.slice(idx + q.length);
    }

    function renderSuggestions(query) {
        if (!suggestions) return;
        if (!query) { suggestions.classList.remove('open'); return; }
        const q    = query.toLowerCase();
        const hits = allScenes.filter(s => (s.title || '').toLowerCase().includes(q)).slice(0, 6);

        if (hits.length === 0) {
            suggestions.innerHTML = `<div class="no-results"><i class="fas fa-search" style="margin-right:6px;"></i>No scenes match "<strong>${query}</strong>"</div>`;
        } else {
            suggestions.innerHTML = hits.map(s => {
                const col = typeBgColors[s.sceneType] || typeBgColors.building;
                return `
                    <div class="suggestion-item" data-id="${s.id}">
                        <div class="suggestion-icon" style="background:${col.icon};border:1px solid ${col.border};color:${col.text};">
                            ${typeIcons[s.sceneType] || '🌐'}
                        </div>
                        <div class="suggestion-info">
                            <strong>${highlight(s.title, q)}</strong>
                            <span>${typeLabels[s.sceneType] || 'Scene'} · ${s.hotSpots?.length || 0} hotspot${(s.hotSpots?.length||0)!==1?'s':''}</span>
                        </div>
                        <i class="fas fa-arrow-right" style="color:var(--text-faint);font-size:0.8rem;"></i>
                    </div>`;
            }).join('');
        }
        suggestions.classList.add('open');
    }

    function filterAndRender(query) {
        const q = (query || '').toLowerCase().trim();
        const filtered = q
            ? allScenes.filter(s =>
                (s.title || '').toLowerCase().includes(q) ||
                (typeLabels[s.sceneType] || '').toLowerCase().includes(q))
            : allScenes;
        renderGridView(filtered);
        buildHierarchyView(filtered);
        updateResultsCount(filtered.length, q);
        if (searchClear) searchClear.className = q ? 'search-clear visible' : 'search-clear';
    }

    searchInput && searchInput.addEventListener('input', (e) => {
        renderSuggestions(e.target.value);
        filterAndRender(e.target.value);
    });

    searchInput && searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            if (suggestions) suggestions.classList.remove('open');
            filterAndRender('');
        }
    });

    searchClear && searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (suggestions) suggestions.classList.remove('open');
        filterAndRender('');
        searchInput && searchInput.focus();
    });

    suggestions && suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) window.location.href = `viewer.html?scene=${item.dataset.id}`;
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrap') && suggestions) {
            suggestions.classList.remove('open');
        }
    });
});
