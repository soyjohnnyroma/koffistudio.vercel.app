/* Koffi Core — Project Store MVP-1A
 * Isolated local project registry. Does not read or write Index V5 V2 storage.
 * Browser: include this file before integration; Node: require() for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KoffiCoreProjectStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'koffi_core_projects_v1';
  const STORE_VERSION = 1;
  const PROJECT_SCHEMA_VERSION = 1;
  const MAX_PROJECTS = 500;
  const STAGES = ['script', 'scenes', 'visuals', 'voice', 'editing', 'delivery'];
  const STAGE_STATES = ['pending', 'in_progress', 'needs_user', 'needs_review', 'completed', 'blocked', 'stale'];

  function now() { return new Date().toISOString(); }
  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'koffi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function cleanText(value, fallback) { return typeof value === 'string' ? value.trim() : (fallback || ''); }

  function emptyStages() {
    return {
      script: { status: 'pending', activeVersionId: null, updatedAt: null },
      scenes: { status: 'pending', activeVersionId: null, updatedAt: null },
      visuals: { status: 'pending', assetIds: [], updatedAt: null },
      voice: { status: 'pending', assetIds: [], updatedAt: null },
      editing: { status: 'pending', editPlanId: null, updatedAt: null },
      delivery: { status: 'pending', assetIds: [], updatedAt: null }
    };
  }

  function createProjectRecord(input) {
    const stamp = now();
    const title = cleanText(input && input.title, 'Producción sin título');
    const project = {
      projectId: makeId(),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      workspaceId: null,
      ownerId: null,
      channelId: null,
      title,
      status: 'draft',
      currentStage: 'script',
      sourceRevision: 1,
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      context: {
        niche: cleanText(input && input.niche),
        platforms: Array.isArray(input && input.platforms) ? input.platforms.slice() : [],
        format: cleanText(input && input.format),
        language: cleanText(input && input.language, 'es'),
        creativeProfileId: cleanText(input && input.creativeProfileId)
      },
      brief: {
        topic: cleanText(input && input.topic),
        reference: cleanText(input && input.reference),
        tone: cleanText(input && input.tone)
      },
      script: { text: '', origin: null, status: 'empty', versions: [] },
      scenes: { items: [], sourceScriptRevision: null, status: 'empty' },
      stages: emptyStages(),
      assetIds: [],
      lastEventId: null,
      sync: { state: 'local_only', serverRevision: null, lastSyncedAt: null },
      archivedAt: null
    };
    return project;
  }

  function validateProject(p) {
    assert(p && typeof p === 'object' && !Array.isArray(p), 'El proyecto debe ser un objeto.');
    assert(typeof p.projectId === 'string' && p.projectId.trim(), 'Falta projectId.');
    assert(p.schemaVersion === PROJECT_SCHEMA_VERSION, 'Versión de proyecto no compatible: ' + p.schemaVersion);
    assert(typeof p.title === 'string' && p.title.trim(), 'El proyecto necesita un título.');
    assert(typeof p.createdAt === 'string' && typeof p.updatedAt === 'string', 'Faltan fechas del proyecto.');
    assert(STAGES.includes(p.currentStage), 'Etapa actual no reconocida.');
    assert(p.stages && typeof p.stages === 'object', 'Faltan estados de etapas.');
    STAGES.forEach(stage => {
      assert(p.stages[stage] && STAGE_STATES.includes(p.stages[stage].status), 'Estado inválido en etapa ' + stage + '.');
    });
    assert(p.context && typeof p.context === 'object', 'Falta context.');
    assert(p.sync && p.sync.state === 'local_only', 'El MVP-1A solo admite estado local_only.');
    return true;
  }

  function validateEnvelope(data) {
    assert(data && typeof data === 'object' && !Array.isArray(data), 'Respaldo inválido.');
    assert(data.storeVersion === STORE_VERSION, 'Versión de almacén no compatible.');
    assert(Array.isArray(data.projects), 'El respaldo no contiene una lista de proyectos.');
    assert(data.projects.length <= MAX_PROJECTS, 'El respaldo supera el máximo de proyectos.');
    const ids = new Set();
    data.projects.forEach(p => {
      validateProject(p);
      assert(!ids.has(p.projectId), 'Hay projectId duplicados en el respaldo.');
      ids.add(p.projectId);
    });
    assert(data.activeProjectId === null || ids.has(data.activeProjectId), 'El proyecto activo no existe en el respaldo.');
    return true;
  }

  function createStore(storage, options) {
    assert(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function', 'Se requiere un adaptador compatible con Storage.');
    const key = (options && options.key) || STORAGE_KEY;

    function emptyEnvelope() {
      return { storeVersion: STORE_VERSION, updatedAt: now(), activeProjectId: null, projects: [] };
    }
    function read() {
      const raw = storage.getItem(key);
      if (!raw) return emptyEnvelope();
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error('El almacén local está dañado: JSON inválido. No se sobrescribió.'); }
      validateEnvelope(data);
      return data;
    }
    function write(data) {
      validateEnvelope(data);
      data.updatedAt = now();
      // Serialize before touching storage; failed writes leave the previous value intact.
      const serialized = JSON.stringify(data);
      storage.setItem(key, serialized);
      return clone(data);
    }
    function list(options) {
      const data = read();
      const includeArchived = !!(options && options.includeArchived);
      return data.projects.filter(p => includeArchived || !p.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    }
    function get(projectId) {
      const p = read().projects.find(item => item.projectId === projectId);
      return p ? clone(p) : null;
    }
    function getActive() {
      const data = read();
      const p = data.projects.find(item => item.projectId === data.activeProjectId);
      return p ? clone(p) : null;
    }
    function create(input) {
      const data = read();
      assert(data.projects.length < MAX_PROJECTS, 'Se alcanzó el máximo de proyectos del MVP.');
      const p = createProjectRecord(input || {});
      data.projects.push(p);
      data.activeProjectId = p.projectId;
      write(data);
      return clone(p);
    }
    function select(projectId) {
      const data = read();
      assert(data.projects.some(p => p.projectId === projectId && !p.archivedAt), 'No existe un proyecto activo con ese identificador.');
      data.activeProjectId = projectId;
      write(data);
      return clone(data.projects.find(p => p.projectId === projectId));
    }
    function update(projectId, updater) {
      assert(typeof updater === 'function', 'update requiere una función.');
      const data = read();
      const index = data.projects.findIndex(p => p.projectId === projectId);
      assert(index >= 0, 'No existe el proyecto que intentas modificar.');
      const draft = clone(data.projects[index]);
      const result = updater(draft) || draft;
      result.projectId = data.projects[index].projectId;
      result.schemaVersion = PROJECT_SCHEMA_VERSION;
      result.createdAt = data.projects[index].createdAt;
      result.updatedAt = now();
      result.revision = (data.projects[index].revision || 1) + 1;
      validateProject(result);
      data.projects[index] = result;
      write(data);
      return clone(result);
    }
    function archive(projectId) {
      const result = update(projectId, p => { p.archivedAt = now(); return p; });
      const data = read();
      if (data.activeProjectId === projectId) {
        const next = data.projects.find(p => !p.archivedAt);
        data.activeProjectId = next ? next.projectId : null;
        write(data);
      }
      return result;
    }
    function exportBackup() {
      const data = read();
      return JSON.stringify({
        format: 'koffi-core-project-backup',
        exportedAt: now(),
        storeVersion: data.storeVersion,
        activeProjectId: data.activeProjectId,
        projects: data.projects
      }, null, 2);
    }
    function importBackup(jsonText, mode) {
      assert(mode === 'replace' || mode === 'merge', 'Indica explícitamente el modo replace o merge.');
      let incoming;
      try { incoming = JSON.parse(jsonText); } catch (_) { throw new Error('El archivo de respaldo no contiene JSON válido.'); }
      validateEnvelope(incoming);
      const current = read();
      let projects;
      let activeProjectId;
      if (mode === 'replace') {
        projects = clone(incoming.projects);
        activeProjectId = incoming.activeProjectId;
      } else {
        const byId = new Map(current.projects.map(p => [p.projectId, p]));
        incoming.projects.forEach(p => {
          const existing = byId.get(p.projectId);
          // Never silently overwrite a local project with an imported copy.
          assert(!existing, 'Conflicto de projectId: ' + p.projectId + '. Elige reemplazar todo o resuelve el conflicto fuera del MVP.');
          byId.set(p.projectId, clone(p));
        });
        projects = Array.from(byId.values());
        assert(projects.length <= MAX_PROJECTS, 'La importación supera el máximo de proyectos.');
        activeProjectId = current.activeProjectId || incoming.activeProjectId;
      }
      const next = { storeVersion: STORE_VERSION, updatedAt: now(), activeProjectId, projects };
      write(next);
      return { imported: incoming.projects.length, total: projects.length, activeProjectId };
    }
    function clearAll() {
      // Deliberately explicit and separate from archive/import; callers must request it.
      storage.removeItem(key);
      return true;
    }

    return Object.freeze({ key, list, get, getActive, create, select, update, archive, exportBackup, importBackup, clearAll });
  }

  return Object.freeze({
    STORAGE_KEY, STORE_VERSION, PROJECT_SCHEMA_VERSION, STAGES, STAGE_STATES,
    createStore, createProjectRecord, validateProject, validateEnvelope
  });
});
