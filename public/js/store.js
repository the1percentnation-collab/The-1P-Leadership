const STATE_KEY = '1p_clc_state';
const NOTE_PREFIX = '1p_note_';

export const store = {
  currentModule: 0,
  completed: new Set(),

  load() {
    try {
      const s = localStorage.getItem(STATE_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        this.currentModule = parsed.current || 0;
        this.completed = new Set(parsed.completed || []);
      }
    } catch (e) {}
  },

  save() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        current: this.currentModule,
        completed: Array.from(this.completed)
      }));
    } catch (e) {}
  },

  setCurrent(id) {
    this.currentModule = id;
    this.save();
  },

  markComplete(id) {
    this.completed.add(id);
    this.save();
  },

  isComplete(id) {
    return this.completed.has(id);
  }
};

export function saveNote(key, val) {
  try { localStorage.setItem(NOTE_PREFIX + key, val); } catch (e) {}
}

export function getNotes(key) {
  try { return localStorage.getItem(NOTE_PREFIX + key) || ''; } catch (e) { return ''; }
}
