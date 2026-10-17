// The Focus Tax · per-essay settings that cannot live in the prose.
//
// Each essay is a markdown file beside this one. Keyed by the `slug` in its
// frontmatter, an entry here can carry:
//
//   brief  The One Percent Brief module that goes deeper on the same subject.
//          The essay ends with a one-line pointer to it, just before the
//          source note. That pointer is the funnel: the Focus Tax is free to
//          members, the Brief is the paid long form. Leave it out when nothing
//          in the Brief covers the subject yet.
//
// Adding an essay is a new markdown file (and an entry here if it points at a
// brief), then `node build-reads.js` for the public pages. The Firestore copy
// is written by the Seed The Focus Tax workflow on merge.
// Brand voice: grounded, clear, no hype, no em dashes.

module.exports = {
  'the-tab-you-never-closed': { brief: 3 },
  'your-todo-list-is-lying': {},
  'meeting-brain-wont-stay-in-the-room': { brief: 3 },
  'fewer-decisions-not-more-focus': {}
};
