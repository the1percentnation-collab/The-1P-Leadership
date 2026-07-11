// ─── DATA ───────────────────────────────────────────────────────
let currentStep = 0;
const totalSteps = 5;
let planData = {};

// ─── INCOME SLIDER ──────────────────────────────────────────────
function updateIncome(val) {
  const num = parseInt(val);
  document.getElementById('income-val').textContent = '$' + num.toLocaleString();
}

// ─── STEP NAVIGATION ────────────────────────────────────────────
function nextStep(from) {
  if (from < totalSteps - 1) {
    document.getElementById('step-' + from).classList.remove('active');
    currentStep = from + 1;
    document.getElementById('step-' + currentStep).classList.add('active');
    updateProgress(from, currentStep);
    document.getElementById('workbook').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function prevStep(from) {
  if (from > 0) {
    document.getElementById('step-' + from).classList.remove('active');
    currentStep = from - 1;
    document.getElementById('step-' + currentStep).classList.add('active');
    updateProgress(null, currentStep);
    document.getElementById('workbook').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function jumpTo(idx) {
  if (idx <= currentStep) {
    document.getElementById('step-' + currentStep).classList.remove('active');
    currentStep = idx;
    document.getElementById('step-' + currentStep).classList.add('active');
    updateProgress(null, currentStep);
  }
}
function updateProgress(completed, active) {
  for (let i = 0; i < totalSteps; i++) {
    const el = document.getElementById('prog-' + i);
    el.classList.remove('active', 'done');
    if (i < active) el.classList.add('done');
    else if (i === active) el.classList.add('active');
  }
}

// ─── GENERATE PLAN ──────────────────────────────────────────────
function generatePlan() {
  // Collect data
  const income = parseInt(document.getElementById('income-slider').value) || 100000;
  const name = document.getElementById('inp-name').value.trim() || 'You';
  const role = document.getElementById('inp-role').value || 'Professional';
  const hours = document.getElementById('inp-hours').value || '10';
  const barrier = document.getElementById('inp-barrier').value || 'clarity';
  const win = document.getElementById('inp-win').value.trim() || 'Achieve my income target and feel aligned with my purpose';
  const email = document.getElementById('inp-email').value.trim();
  const reviewDay = document.querySelector('input[name="review-day"]:checked')?.value || 'Sunday';
  const focuses = [...document.querySelectorAll('input[name="focus"]:checked')].map(el => el.value);

  planData = { income, name, role, hours, barrier, win, email, reviewDay, focuses };

  // Calculate milestones
  const monthly = Math.round(income / 12);
  const weekly = Math.round(income / 52);
  const q1Target = Math.round(income * 0.2);
  const q2Target = Math.round(income * 0.25);
  const q3Target = Math.round(income * 0.25);

  // Update header
  document.getElementById('out-name').textContent = name.toUpperCase() + "'S 90-DAY PLAN";
  document.getElementById('out-sub').textContent = `Built for a $${income.toLocaleString()} year. Role: ${role}. Review day: ${reviewDay}.`;
  document.getElementById('out-income').innerHTML = `<span class="red">$${income.toLocaleString()}</span>`;
  document.getElementById('out-monthly').innerHTML = `<span class="red">$${monthly.toLocaleString()}</span>`;
  document.getElementById('out-weekly').innerHTML = `<span class="red">$${weekly.toLocaleString()}</span>`;
  document.getElementById('out-daily').innerHTML = `<span class="red">${parseInt(hours) >= 20 ? '5' : parseInt(hours) >= 10 ? '3' : '2'}</span>`;

  // Generate OKR blocks
  const focusLabels = {
    mindset: 'Mindset & Mental Frameworks',
    revenue: 'Revenue Generation Systems',
    leadership: 'Leadership Development',
    habits: 'High-Performance Daily Habits',
    clarity: 'Strategic Clarity & Focus',
    relationships: 'High-Value Relationships',
    health: 'Physical Energy & Health',
    purpose: 'Purpose Alignment',
    confidence: 'Confidence & Identity',
    systems: 'Operational Systems'
  };
  const focusNames = focuses.length > 0
    ? focuses.map(f => focusLabels[f]).join(', ')
    : 'Revenue, Mindset & Execution';

  const okrs = [
    {
      phase: 'M1', objective: 'ESTABLISH THE FOUNDATION',
      period: 'Month 1 · Days 1–30',
      krs: [
        { text: `Define 3 revenue actions that generate $${Math.round(q1Target/3).toLocaleString()} toward Q1 target`, progress: 0 },
        { text: `Build a daily habit stack matching your ${hours}-hour/week commitment`, progress: 0 },
        { text: `Complete a full audit of current blockers: ${barrier}`, progress: 0 },
      ]
    },
    {
      phase: 'M2', objective: 'BUILD EXECUTION MOMENTUM',
      period: 'Month 2 · Days 31–60',
      krs: [
        { text: `Hit $${Math.round(income/6).toLocaleString()} in cumulative progress toward annual target`, progress: 0 },
        { text: `Establish ${reviewDay} weekly review habit — track 4 consecutive reviews`, progress: 0 },
        { text: `Document and systemize top 2 income-generating activities`, progress: 0 },
      ]
    },
    {
      phase: 'M3', objective: 'COMPOUND THE GAINS',
      period: 'Month 3 · Days 61–90',
      krs: [
        { text: `Reach $${Math.round(income/4).toLocaleString()} toward annual target — 25% milestone`, progress: 0 },
        { text: `Achieve consistency score of 80%+ on daily execution checklist`, progress: 0 },
        { text: `Complete a 90-day retrospective and set next quarter's OKRs`, progress: 0 },
      ]
    }
  ];

  const okrHTML = okrs.map(o => `
    <div class="okr-card" style="margin-bottom:16px;">
      <div class="okr-card-header">
        <div class="okr-phase">${o.phase}</div>
        <div>
          <div class="okr-objective">${o.objective}</div>
          <div class="okr-period">${o.period}</div>
        </div>
      </div>
      <div class="okr-krs">
        ${o.krs.map((kr, i) => `
          <div class="kr-row">
            <div class="kr-num">KR ${i+1}</div>
            <div class="kr-text">${kr.text}</div>
            <div class="kr-bar-wrap"><div class="kr-bar" style="width:${kr.progress}%"></div></div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
  document.getElementById('okr-blocks').innerHTML = okrHTML;

  // Generate habit stack
  const habitMap = {
    mindset: { icon: '🧠', title: 'Mindset Morning', desc: 'Read or journal for 10 min on a growth topic before checking any device.' },
    revenue: { icon: '💰', title: 'Revenue Action Block', desc: `Dedicate your best ${parseInt(hours) >= 20 ? '2 hours' : '1 hour'} to your #1 income-generating activity. No multitasking.` },
    leadership: { icon: '⚡', title: 'Leadership Reflection', desc: 'End each day with 5 min reviewing: What did I model today? Who did I develop?' },
    habits: { icon: '🔄', title: 'Habit Stack Audit', desc: 'Log your daily habits. Mark done or not. Review weekly. Adjust monthly.' },
    clarity: { icon: '🎯', title: 'Weekly Clarity Reset', desc: `Every ${reviewDay}, define your Top 3 priorities before touching email or social.` },
    relationships: { icon: '🤝', title: 'Connection Outreach', desc: 'Reach out to 1 meaningful contact per week. Add value, not an ask.' },
    health: { icon: '💪', title: 'Energy First', desc: 'Move your body for 20 min before your workday begins. Non-negotiable.' },
    purpose: { icon: '🧭', title: 'Purpose Check-In', desc: 'Weekly: Does what I did this week connect to why I started? Adjust if not.' },
    confidence: { icon: '🦁', title: 'Identity Reps', desc: 'Do 1 thing daily that your future self would do. Even if small.' },
    systems: { icon: '⚙️', title: 'Systems Build Hour', desc: 'Weekly: Document one process you repeated. Turn it into a template or checklist.' }
  };

  const activeHabits = focuses.length > 0 ? focuses.slice(0, 4) : ['mindset', 'revenue', 'habits', 'clarity'];
  const habitsHTML = activeHabits.map((f, i) => {
    const h = habitMap[f] || habitMap['mindset'];
    return `
      <div class="habit-card">
        <div class="habit-week">${h.icon} Daily Priority ${i+1}</div>
        <div class="habit-title">${h.title}</div>
        <div class="habit-desc">${h.desc}</div>
      </div>
    `;
  }).join('');
  document.getElementById('habits-output').innerHTML = habitsHTML;

  // Generate daily checklist
  const checkItems = [
    `📌 Top 3 priorities written before starting work`,
    `💰 Revenue-generating action completed (target: $${Math.round(weekly/5).toLocaleString()}/day)`,
    `🧠 Mindset practice done (reading, journaling, or audio)`,
    `📊 Progress tracked in workbook or tracker`,
    `🔄 End-of-day review: What worked? What didn't? Adjust tomorrow.`,
    `🤝 One connection made or maintained`,
  ];
  const checklistHTML = checkItems.map(item => `
    <div class="check-row">
      <div class="check-circle"></div>
      <div class="check-row-text">${item}</div>
    </div>
  `).join('');
  document.getElementById('checklist-output').innerHTML = checklistHTML;

  // Show plan
  document.getElementById('step-' + currentStep).style.display = 'none';
  document.getElementById('progress-track').style.display = 'none';
  const output = document.getElementById('plan-output');
  output.classList.add('visible');
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Optionally submit to HL survey
  if (email) {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = `https://api.leadconnectorhq.com/widget/survey/bhIS7gQCcguEIYLf2gE8?notrack=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
      link.target = '_blank';
      // Silently open in background — comment this out if you don't want auto-redirect
      // link.click();
    }, 3000);
  }
}

function resetWorkbook() {
  location.reload();
}

// ─── FOCUS AREA MAX 3 ───────────────────────────────────────────
document.addEventListener('change', function(e) {
  if (e.target.name === 'focus') {
    const checked = document.querySelectorAll('input[name="focus"]:checked');
    if (checked.length > 3) {
      e.target.checked = false;
    }
  }
});

// ─── SCROLL ANIMATIONS ──────────────────────────────────────────
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));

// ─── PAGE TRANSITION ─────────────────────────────────────────
(function() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#E60306;transform:scaleX(1);transform-origin:right;pointer-events:none;';
  document.body.appendChild(overlay);
  window.addEventListener('load', () => {
    overlay.style.transition = 'transform 0.45s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.transform = 'scaleX(0)';
    }));
  });
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.style.transformOrigin = 'left';
      overlay.style.transition = 'transform 0.35s cubic-bezier(0.76,0,0.24,1)';
      overlay.style.transform = 'scaleX(1)';
      setTimeout(() => { window.location.href = href; }, 340);
    });
  });
})();

// ─── MAGNETIC BUTTONS ────────────────────────────────────────
document.querySelectorAll('.btn-submit, .cdb-cta').forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width/2) * 0.2;
    const dy = (e.clientY - rect.top  - rect.height/2) * 0.2;
    btn.style.transform = `translate(${dx}px,${dy}px) scale(1.02)`;
    btn.style.boxShadow = '0 8px 28px rgba(230,3,6,0.3)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '';
  });
});

// ─── STAGGER LIST ────────────────────────────────────────────
const staggerObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); staggerObs.unobserve(e.target); }});
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.stagger-list').forEach(el => staggerObs.observe(el));

// Bindings for former inline handlers (R7 — CSP: no inline JS).
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => {
    const action = el.getAttribute('data-action');
    const arg = el.getAttribute('data-arg');
    const n = arg == null ? undefined : Number(arg);
    switch (action) {
      case 'jumpTo': jumpTo(n); break;
      case 'nextStep': nextStep(n); break;
      case 'prevStep': prevStep(n); break;
      case 'generatePlan': generatePlan(); break;
      case 'resetWorkbook': resetWorkbook(); break;
      case 'print': window.print(); break;
      case 'scrollTo': {
        const t = document.getElementById(arg);
        if (t) t.scrollIntoView({ behavior: 'smooth' });
        break;
      }
    }
  });
});
const incomeSlider = document.getElementById('income-slider');
if (incomeSlider) incomeSlider.addEventListener('input', (e) => updateIncome(e.target.value));

