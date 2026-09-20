(() => {
  "use strict";

  const book = window.BOOK_DATA;
  if (!book?.sections?.length) throw new Error("Book content could not be loaded.");

  const behaviorSections = Array.isArray(window.HUMAN_SURVIVAL_BEHAVIORS) ? window.HUMAN_SURVIVAL_BEHAVIORS : [];
  const backMatterSections = Array.isArray(window.BACK_MATTER_ONE) ? window.BACK_MATTER_ONE : [];
  const sections = [...book.sections];
  const behaviorInsertAt = sections.findIndex((section) => section.id === "chapter-14");
  sections.splice(behaviorInsertAt < 0 ? sections.length : behaviorInsertAt, 0, ...behaviorSections);
  sections.push(...backMatterSections);
  const storage = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Reading still works without storage. */ }
    }
  };

  const state = {
    index: 0,
    bookmarks: new Set(storage.read("leth-bookmarks", [])),
    font: storage.read("leth-font", "medium"),
    highContrast: storage.read("leth-contrast", false),
    quiet: storage.read("leth-quiet", false),
    motion: storage.read("leth-motion", !window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    narrationSection: null,
    narrationPart: 0,
    narrationSavedSecond: -1,
    searchBuilt: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    shell: $("#app-shell"), list: $("#chapter-list"), content: $("#chapter-content"), label: $("#chapter-label"),
    title: $("#chapter-title"), copy: $("#chapter-copy"), diagram: $("#diagram-stage"), visualKicker: $("#visual-kicker"),
    visualTitle: $("#visual-title"), visualCaption: $("#visual-caption"), visualLegend: $("#visual-legend"),
    counter: $("#chapter-counter"), progress: $("#progress-fill"), progressBar: $(".progress-track"),
    progressLabel: $("#progress-label"), progressPercent: $("#progress-percent"), previous: $("#previous-button"),
    next: $("#next-button"), play: $("#play-button"), listen: $("#listen-button"), bookmark: $("#bookmark-button"),
    inlineBookmark: $("#inline-bookmark"), bookmarkCount: $("#bookmark-count"), railToggle: $("#rail-toggle"),
    motionToggle: $("#motion-toggle"), searchButton: $("#search-button"), searchDialog: $("#search-dialog"),
    searchInput: $("#search-input"), searchStatus: $("#search-status"), settingsButton: $("#settings-button"),
    fullscreen: $("#fullscreen-button"), home: $("#home-button"), read: $("#read-mode"),
  };

  const settings = document.createElement("aside");
  settings.className = "settings-card glass-panel";
  settings.id = "settings-card";
  settings.hidden = true;
  settings.setAttribute("aria-label", "Reading settings");
  settings.innerHTML = `
    <header><div><p>Display controls</p><h2>Reading settings</h2></div><button class="icon-button" id="settings-close" type="button" aria-label="Close reading settings">×</button></header>
    <fieldset><legend>Text size</legend><div class="segmented" aria-label="Text size">
      <button type="button" data-font="small" aria-label="Small text">A</button>
      <button type="button" data-font="medium" aria-label="Medium text">A</button>
      <button type="button" data-font="large" aria-label="Large text">A</button>
    </div></fieldset>
    <label class="setting-row"><span>Higher text contrast</span><input id="contrast-toggle" type="checkbox"></label>
    <label class="setting-row"><span>Quieter star field</span><input id="quiet-toggle" type="checkbox"></label>`;
  document.body.append(settings);

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  document.body.append(toast);

  const narration = $("#narration-audio");
  narration.preload = "none";
  narration.playsInline = true;

  function plain(html) {
    const node = document.createElement("div");
    node.innerHTML = html;
    return node.textContent || "";
  }

  function chapterNumberLabel(section) {
    if (section.id === "introduction") return "00";
    if (section.id === "appendix") return "A";
    if (section.label.startsWith("Earth Cuisine ")) return `C${section.label.split(" ").at(-1).replace(/^0/, "")}`;
    if (section.label.startsWith("Human Survival Behavior ")) return `B${section.label.split(" ").at(-1).replace(/^0/, "")}`;
    if (section.id === "back-matter-1-introduction") return "BM1";
    if (section.label.startsWith("Nomenclature Entry ")) return `N${section.label.split(" ").at(-1).replace(/^0/, "")}`;
    if (section.id === "nomenclature-henry-atlantic") return "N7+";
    if (section.id === "field-note-pointing") return "PT";
    return String(section.number).padStart(2, "0");
  }

  function buildNavigation() {
    const fragment = document.createDocumentFragment();
    sections.forEach((section, index) => {
      const item = document.createElement("li");
      item.dataset.index = String(index);
      item.dataset.sectionId = section.id;
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<span class="chapter-number">${chapterNumberLabel(section)}</span><span class="chapter-name"></span><span class="bookmark-indicator" hidden></span>`;
      button.querySelector(".chapter-name").textContent = section.title;
      button.addEventListener("click", () => navigate(index));
      item.append(button);
      fragment.append(item);
    });
    els.list.replaceChildren(fragment);
    refreshBookmarks();
  }

  function renderBlocks(section) {
    const fragment = document.createDocumentFragment();
    let list = null;
    for (const block of section.blocks) {
      if (block.type === "bullet") {
        if (!list) {
          list = document.createElement("ul");
          fragment.append(list);
        }
        const item = document.createElement("li");
        item.innerHTML = block.html;
        list.append(item);
        continue;
      }
      list = null;
      if (block.type === "subheading") {
        const heading = document.createElement("h3");
        heading.innerHTML = block.html;
        fragment.append(heading);
      } else {
        const paragraph = document.createElement("p");
        if (block.type === "opening") paragraph.className = "opening";
        paragraph.innerHTML = block.html;
        fragment.append(paragraph);
      }
    }
    els.copy.replaceChildren(fragment);
  }

  function modeFor(section) {
    const n = section.number;
    if (section.visualMode) return section.visualMode;
    if (section.id === "introduction") return "orientation";
    if (section.id === "appendix") return "principles";
    if ([1, 4, 10, 33].includes(n)) return "orientation";
    if ([2, 3, 5].includes(n)) return "signal";
    if ([6, 7, 8, 9].includes(n)) return "routes";
    if (n <= 16) return "terra";
    if (n <= 21) return "localization";
    if (n === 22) return "time";
    if ([23, 24].includes(n)) return "relation";
    if (n <= 27) return "network";
    if (n === 28) return "localization";
    if (n <= 32) return "continuity";
    if (n === 34) return "translation";
    if (n <= 41) return "translation";
    return "integration";
  }

  const visualCopy = {
    orientation: ["Orientation model", "A larger conversation", "Terra is joining a community, not a hierarchy.", [["yellow","Terra"],["cyan","Other perspectives"],["lime","New connection"]]],
    signal: ["Observation model", "Signals and perspective", "Observation is an exchange of incomplete signals, not a complete view.", [["yellow","Terra"],["cyan","Outbound signal"],["coral","Inbound signal"]]],
    routes: ["Transit model", "Compatibility before arrival", "Several routes may be available. Only a compatible route reaches arrival.", [["yellow","Journey endpoints"],["cyan","Candidate route"],["lime","Compatible path"],["coral","Boundary stop"]]],
    terra: ["Terra model", "The local peculiarities", "Observation produces a model. Local details are what force the model to improve.", [["yellow","Terra"],["cyan","Observation"],["lime","Model revision"],["coral","Local anomaly"]]],
    localization: ["Interface model", "Pattern becomes person", "A persistent pattern localized through a finite interface becomes this person.", [["cyan","Persistent pattern"],["yellow","Local person"],["coral","Interface limit"]]],
    time: ["Temporal model", "Sequence and relation", "Human experience follows a sequence. Other relations can surround the same events.", [["yellow","Human sequence"],["cyan","Relational view"],["lime","Embodied present"]]],
    relation: ["Relational model", "Not a stack of places", "Access and relation can differ without arranging consciousness into floors.", [["yellow","Embodied viewpoint"],["cyan","Other modes"],["lime","Access relations"],["coral","Rejected hierarchy"]]],
    network: ["Network model", "Connected is not exposed", "A participant can accept one addressed exchange while the rest of its boundary remains closed.", [["cyan","Participant"],["lime","Addressed exchange"],["yellow","Consent gate"],["coral","Privacy boundary"]]],
    continuity: ["Continuity model", "Experience changes the pattern", "The pattern persists through experience, but persistence does not mean remaining unchanged.", [["cyan","Persistent pattern"],["yellow","Finite experience"],["lime","Changed continuity"]]],
    translation: ["Translation model", "The interface must draw something", "Source information becomes a form the receiving interface can represent.", [["cyan","Source"],["yellow","Interface"],["coral","Rendered form"]]],
    integration: ["Integration model", "The Network gains Terra", "Terra does not enter an empty slot. Its arrival creates new relationships.", [["yellow","Terra"],["cyan","Existing network"],["lime","New relationships"]]],
    principles: ["Reference model", "Load-bearing assumptions", "Equality is central; perspective, relation, and limits shape every usable view.", [["yellow","Equality"],["cyan","Perspective"],["lime","Relation"],["coral","Limits"]]],
    cuisine: ["Cuisine model", "Bureaucratic distance", "A shorter operational path keeps the cook, ingredient, and customer close to one another.", [["cyan","Ingredient"],["yellow","Cook"],["lime","Customer"],["coral","Administrative layer"]]],
    pointing: ["Communication model", "Shared attention", "Pointing works when both participants can connect the gesture to the same visible referent.", [["cyan","Speaker"],["yellow","Gesture"],["lime","Visible referent"],["coral","Context check"]]],
    "food-chain": ["Cuisine model", "Edible transformations", "Earth cuisine often begins with material humans cannot eat and ends with a meal through biological cooperation.", [["cyan","Source system"],["yellow","Living intermediary"],["lime","Human food"],["coral","Transformation"]]],
    transformation: ["Cuisine model", "Ingredients become meaning", "Technique changes ordinary ingredients into a form with both culinary and social function.", [["cyan","Ingredients"],["yellow","Technique"],["lime","Finished food"],["coral","Social meaning"]]],
    perception: ["Cuisine model", "The cake uncertainty problem", "Visual evidence becomes unreliable when cake reproduces the surface properties of ordinary objects.", [["cyan","Observed object"],["yellow","Visual evidence"],["lime","Cake"],["coral","Uncertainty"]]],
    stimulant: ["Cuisine model", "Borrowed wakefulness", "A plant defense occupies fatigue receptors, temporarily changing the human experience of alertness.", [["cyan","Plant compound"],["yellow","Receptor"],["lime","Alertness"],["coral","Deferred fatigue"]]],
    chemistry: ["Cuisine model", "Compatible chemistry", "Independent evolutionary histories produced molecules capable of interacting across species.", [["cyan","Plant chemistry"],["yellow","Molecular fit"],["lime","Human system"],["coral","Independent evolution"]]],
    behavior: ["Behavior model", "From burden to usable form", "Humans rarely remove the original difficulty. They change its shape until action becomes possible again.", [["coral","Raw difficulty"],["yellow","Human response"],["cyan","Narrative form"],["lime","Continued action"]]],
    nomenclature: ["Nomenclature model", "The human spark", "Contact produces a reaction; naming preserves a trace of the human observer on the thing observed.", [["cyan","Observed thing"],["yellow","Human contact"],["coral","Emotional trace"],["lime","Name"]]],
  };

  function defs() {
    return `<defs>
      <filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="planet"><stop offset="0" stop-color="#fff9b0"/><stop offset=".36" stop-color="#ffe34b"/><stop offset="1" stop-color="#d69212"/></radialGradient>
      <linearGradient id="pane" x1="0" x2="1"><stop stop-color="#0b4ba3" stop-opacity=".65"/><stop offset="1" stop-color="#061737" stop-opacity=".15"/></linearGradient>
    </defs>`;
  }

  function baseSvg(inner, label) {
    return `<svg viewBox="0 0 520 420" role="img" aria-label="${label}">${defs()}${inner}</svg>`;
  }

  function diagramMarkup(mode) {
    if (mode === "nomenclature") return baseSvg(`
      <text class="diagram-label" x="42" y="54">CONTACT LEAVES A TRACE</text>
      <path class="route cyan" d="M82 210 C148 210 176 210 222 210"/><path class="route coral" d="M298 210 C344 210 372 210 438 210"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="82" cy="210" r="27"/><circle class="node yellow" cx="260" cy="210" r="39"/><circle class="node coral" cx="438" cy="210" r="27"/></g>
      <path class="route lime" d="M260 249 C260 292 260 316 260 350"/><circle class="node lime" cx="260" cy="350" r="22"/>
      <text class="diagram-small" x="40" y="263">OBSERVED THING</text><text class="diagram-small" x="220" y="205">HUMAN</text><text class="diagram-small" x="215" y="224">CONTACT</text><text class="diagram-small" x="390" y="263">REACTION</text><text class="diagram-label" x="235" y="393">NAME</text>`, "A nonhuman thing meets a human observer; the reaction survives as a name");

    if (mode === "behavior") return baseSvg(`
      <text class="diagram-label" x="38" y="58">RAW DIFFICULTY</text><text class="diagram-label" x="370" y="58">CONTINUED ACTION</text>
      <path class="route coral" d="M82 142 C176 142 177 210 260 210"/><path class="route yellow" d="M260 210 C343 210 344 278 438 278"/>
      <path class="route lime" d="M82 278 C176 278 177 210 260 210 C343 210 344 142 438 142"/>
      <g filter="url(#glow)"><circle class="node coral" cx="82" cy="142" r="26"/><circle class="node yellow" cx="260" cy="210" r="39"/><circle class="node cyan" cx="82" cy="278" r="20"/><circle class="node lime" cx="438" cy="142" r="26"/><circle class="node cyan" cx="438" cy="278" r="20"/></g>
      <text class="diagram-small" x="215" y="205">ADAPTIVE</text><text class="diagram-small" x="218" y="224">RESPONSE</text><text class="diagram-small" x="42" y="327">NARRATIVE FORM</text><text class="diagram-small" x="380" y="327">BURDEN CARRIED</text>
      <circle class="packet" r="6"><animateMotion dur="4s" repeatCount="indefinite" path="M82 278 C176 278 177 210 260 210 C343 210 344 142 438 142"/></circle>`, "A difficult event transformed through an adaptive human response into a form that permits continued action");

    if (mode === "food-chain") return baseSvg(`
      <text class="diagram-label" x="49" y="58">SOURCE SYSTEM</text><text class="diagram-label" x="377" y="58">HUMAN FOOD</text>
      <path class="route coral" d="M92 210 C171 111 344 111 428 210"/><path class="route lime" d="M92 210 C174 309 346 309 428 210"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="92" cy="210" r="28"/><circle class="node yellow" cx="260" cy="210" r="38"/><circle class="node lime" cx="428" cy="210" r="28"/></g>
      <text class="diagram-small" x="207" y="204">LIVING</text><text class="diagram-small" x="191" y="222">INTERMEDIARY</text><text class="diagram-small" x="151" y="105">BIOLOGICAL TRANSFORMATION</text><text class="diagram-small" x="168" y="341">ECOLOGICAL RELATIONSHIP</text>`, "A source ecosystem becomes human food through a living intermediary and ecological transformation");

    if (mode === "transformation") return baseSvg(`
      <path class="route" d="M78 210 H442"/><g filter="url(#glow)"><circle class="node cyan" cx="78" cy="210" r="24"/><circle class="node yellow" cx="199" cy="210" r="30"/><circle class="node lime" cx="321" cy="210" r="30"/><circle class="node coral" cx="442" cy="210" r="24"/></g>
      <text class="diagram-label" x="42" y="160">INGREDIENTS</text><text class="diagram-label" x="165" y="160">TECHNIQUE</text><text class="diagram-label" x="287" y="160">FOOD</text><text class="diagram-label" x="394" y="160">MEANING</text>
      <text class="diagram-small" x="66" y="274">MATERIAL</text><text class="diagram-small" x="166" y="284">TRANSFORMATION</text><text class="diagram-small" x="291" y="274">SENSORY</text><text class="diagram-small" x="397" y="274">SOCIAL</text>`, "Ingredients transformed by technique into food that carries social meaning");

    if (mode === "perception") return baseSvg(`
      <text class="diagram-label" x="171" y="55">VISUAL CLASSIFICATION</text><path class="route yellow" d="M260 92 V180"/><path class="route lime" d="M260 180 C212 215 162 247 112 300"/><path class="route coral" d="M260 180 C308 215 358 247 408 300"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="260" cy="92" r="27"/><circle class="node yellow" cx="260" cy="180" r="19"/><circle class="node lime" cx="112" cy="300" r="31"/><circle class="node coral" cx="408" cy="300" r="31"/></g>
      <text class="diagram-small" x="218" y="140">APPEARANCE</text><text class="diagram-label" x="78" y="353">OBJECT</text><text class="diagram-label" x="385" y="353">CAKE</text><text class="diagram-small" x="202" y="391">KNIFE PROVIDES VERIFICATION</text>`, "The same visual evidence can indicate an ordinary object or a cake until cutting provides verification");

    if (mode === "stimulant") return baseSvg(`
      <text class="diagram-label" x="44" y="64">PLANT DEFENSE</text><path class="route yellow" d="M98 135 C181 174 220 196 260 210"/><path class="route lime" d="M260 210 C320 198 372 174 425 135"/><path class="route coral" d="M425 158 C396 243 348 302 286 342"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="98" cy="135" r="28"/><circle class="node yellow" cx="260" cy="210" r="39"/><circle class="node lime" cx="425" cy="135" r="28"/><circle class="node coral" cx="280" cy="348" r="19"/></g>
      <text class="diagram-small" x="224" y="204">FATIGUE</text><text class="diagram-small" x="218" y="223">RECEPTOR</text><text class="diagram-label" x="389" y="91">ALERTNESS</text><text class="diagram-small" x="216" y="389">FATIGUE DEFERRED</text>`, "A plant compound occupies a fatigue receptor, producing alertness while fatigue is deferred");

    if (mode === "chemistry") return baseSvg(`
      <text class="diagram-label" x="41" y="63">PLANT EVOLUTION</text><text class="diagram-label" x="354" y="63">HUMAN EVOLUTION</text><path class="route coral" d="M93 131 C159 175 194 195 230 210"/><path class="route coral" d="M427 131 C361 175 326 195 290 210"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="93" cy="131" r="29"/><circle class="node lime" cx="427" cy="131" r="29"/><circle class="node yellow" cx="260" cy="210" r="34"/></g>
      <path class="route lime" d="M260 244 V346"/><circle class="node coral" cx="260" cy="350" r="19"/><text class="diagram-label" x="202" y="216">MOLECULAR FIT</text><text class="diagram-small" x="194" y="391">UNPLANNED INTERACTION</text>`, "Independent plant and human evolution converging on a compatible molecular interaction");

    if (mode === "cuisine") return baseSvg(`
      <text class="diagram-label" x="42" y="54">LOW BUREAUCRATIC DISTANCE</text>
      <path class="route lime" d="M92 138 H428"/><g filter="url(#glow)"><circle class="node cyan" cx="92" cy="138" r="22"/><circle class="node yellow" cx="260" cy="138" r="28"/><circle class="node lime" cx="428" cy="138" r="22"/></g>
      <text class="diagram-small" x="58" y="184">INGREDIENT</text><text class="diagram-small" x="244" y="184">COOK</text><text class="diagram-small" x="397" y="184">CUSTOMER</text>
      <text class="diagram-label" x="42" y="252">INSTITUTIONAL PATH</text><path class="route coral" d="M92 318 H428"/>
      <g><circle class="node cyan" cx="92" cy="318" r="18"/><rect x="151" y="300" width="38" height="36" rx="8" fill="none" stroke="#ff7b6d" stroke-width="2"/><rect x="218" y="300" width="38" height="36" rx="8" fill="none" stroke="#ff7b6d" stroke-width="2"/><rect x="285" y="300" width="38" height="36" rx="8" fill="none" stroke="#ff7b6d" stroke-width="2"/><circle class="node lime" cx="428" cy="318" r="18"/></g>
      <text class="diagram-small" x="144" y="369">PURCHASE</text><text class="diagram-small" x="211" y="389">STANDARDIZE</text><text class="diagram-small" x="286" y="369">APPROVE</text>`, "A short ingredient-to-customer path compared with a longer institutional path");

    if (mode === "pointing") return baseSvg(`
      <text class="diagram-label" x="42" y="54">VISIBLE REFERENT</text>
      <path class="route yellow" d="M112 218 C190 166 305 146 414 126"/><path class="route coral" d="M414 151 C314 194 212 238 128 254"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="104" cy="236" r="31"/><circle class="node yellow" cx="260" cy="177" r="13"/><circle class="node lime" cx="420" cy="124" r="27"/></g>
      <text class="diagram-label" x="68" y="294">SPEAKER</text><text class="diagram-small" x="229" y="145">GESTURE</text><text class="diagram-label" x="382" y="82">OBJECT</text>
      <rect x="175" y="319" width="170" height="46" rx="23" fill="url(#pane)" stroke="#ff7b6d" stroke-opacity=".75"/><text class="diagram-small" x="207" y="347">CONTEXT CONFIRMS</text>
      <circle class="packet" r="6"><animateMotion dur="3.6s" repeatCount="indefinite" path="M112 218 C190 166 305 146 414 126"/></circle>`, "A speaker uses a gesture to establish shared attention on a visible object, with context confirming the meaning");

    if (mode === "time") return baseSvg(`
      <text class="diagram-label" x="48" y="52">HUMAN SEQUENCE</text><line class="route yellow" x1="52" y1="98" x2="462" y2="98"/>
      <g filter="url(#glow)"><circle class="node yellow" cx="82" cy="98" r="10"/><circle class="node yellow" cx="174" cy="98" r="12"/><circle class="node lime" cx="281" cy="98" r="18"/><circle class="node yellow" cx="423" cy="98" r="11"/></g>
      <text class="diagram-small" x="248" y="135">EMBODIED PRESENT</text><text class="diagram-label" x="48" y="188">RELATIONAL VIEW</text>
      <g><path class="route" d="M83 282 C142 166 373 172 408 327"/><path class="route" d="M83 282 C180 380 341 370 408 327"/><path class="route" d="M83 282 C205 225 293 220 408 327"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="83" cy="282" r="13"/><circle class="node cyan" cx="173" cy="226" r="11"/><circle class="node lime" cx="260" cy="282" r="27"/><circle class="node cyan" cx="370" cy="194" r="13"/><circle class="node cyan" cx="408" cy="327" r="12"/></g></g>`, "A human sequence compared with a relational view of the same events");

    if (mode === "relation") return baseSvg(`
      <g opacity=".7"><rect x="36" y="91" width="132" height="47" rx="9" fill="none" stroke="#ff7b6d" stroke-width="2"/><rect x="36" y="157" width="132" height="47" rx="9" fill="none" stroke="#ff7b6d" stroke-width="2"/><rect x="36" y="223" width="132" height="47" rx="9" fill="none" stroke="#ff7b6d" stroke-width="2"/><text class="diagram-small" x="74" y="120">HIGHER</text><text class="diagram-small" x="77" y="186">MIDDLE</text><text class="diagram-small" x="77" y="252">LOWER</text><line x1="27" y1="72" x2="180" y2="289" stroke="#ff7b6d" stroke-width="5"/><line x1="180" y1="72" x2="27" y2="289" stroke="#ff7b6d" stroke-width="5"/><text class="diagram-label" x="48" y="323">NOT FLOORS</text></g>
      <g class="routes"><path class="route lime" d="M341 209 C326 144 297 111 264 92"/><path class="route lime" d="M341 209 C396 178 424 158 459 127"/><path class="route lime" d="M341 209 C383 265 402 303 432 337"/><path class="route lime" d="M341 209 C287 250 266 290 239 336"/></g>
      <g filter="url(#glow)"><circle class="node yellow" cx="341" cy="209" r="29"/><circle class="node cyan" cx="264" cy="92" r="15"/><circle class="node cyan" cx="459" cy="127" r="14"/><circle class="node cyan" cx="432" cy="337" r="15"/><circle class="node cyan" cx="239" cy="336" r="13"/></g>
      <text class="diagram-label" x="298" y="215">VIEWPOINT</text><text class="diagram-small" x="279" y="66">DIFFERENT MODES</text><text class="diagram-small" x="327" y="379">RELATED BY ACCESS, NOT HEIGHT</text>`, "A rejected hierarchy beside a non-spatial web of access relations");

    if (mode === "network") return baseSvg(`
      <g class="routes"><path class="route" d="M93 210 C164 80 348 78 430 200"/><path class="route" d="M93 210 C176 344 349 344 430 200"/><path class="route lime" d="M93 210 C205 171 319 171 430 200"/></g>
      <g filter="url(#glow)"><circle class="node cyan" cx="93" cy="210" r="25"/><circle class="node cyan" cx="207" cy="111" r="18"/><circle class="node cyan" cx="430" cy="200" r="25"/><circle class="node cyan" cx="345" cy="319" r="18"/></g>
      <circle cx="93" cy="210" r="45" fill="none" stroke="#ff7b6d" stroke-width="3" stroke-dasharray="4 8"/><circle cx="430" cy="200" r="45" fill="none" stroke="#ff7b6d" stroke-width="3" stroke-dasharray="4 8"/>
      <rect x="247" y="173" width="27" height="12" rx="6" fill="#ffe34b" filter="url(#glow)"/><text class="diagram-small" x="221" y="153">CONSENT GATE</text>
      <circle class="packet" r="6"><animateMotion dur="4s" repeatCount="indefinite" path="M93 210 C205 171 319 171 430 200"/></circle>
      <text class="diagram-small" x="47" y="274">PRIVATE</text><text class="diagram-small" x="396" y="264">PRIVATE</text><text class="diagram-label" x="176" y="391">ONE ADDRESSED EXCHANGE</text>`, "Two private participants accepting one addressed exchange");

    if (mode === "integration") return baseSvg(`
      <g class="routes"><path class="route" d="M206 100 C285 70 386 116 422 204"/><path class="route" d="M206 100 C238 195 281 277 372 327"/><path class="route" d="M422 204 C404 253 394 291 372 327"/></g>
      <g filter="url(#glow)"><circle class="node cyan" cx="206" cy="100" r="20"/><circle class="node cyan" cx="422" cy="204" r="22"/><circle class="node cyan" cx="372" cy="327" r="19"/><circle class="node cyan" cx="281" cy="224" r="28"/></g>
      <circle class="halo" cx="74" cy="338" r="40"/><circle class="node yellow" cx="74" cy="338" r="22"/><text class="diagram-small" x="43" y="389">TERRA</text>
      <path class="route lime" d="M92 325 C154 274 207 250 257 231"/><path class="route lime" d="M90 318 C145 204 169 153 195 117"/><path class="route lime" d="M97 346 C193 366 285 352 354 332"/>
      <circle class="packet" r="6"><animateMotion dur="4s" repeatCount="indefinite" path="M92 325 C154 274 207 250 257 231"/></circle>
      <text class="diagram-label" x="248" y="55">EXISTING NETWORK</text><text class="diagram-small" x="121" y="293">NEW RELATIONSHIPS</text>`, "Terra creating several new relationships within an existing network");

    if (mode === "translation") return baseSvg(`<g class="float-group">
      <rect x="42" y="80" width="118" height="260" rx="22" fill="url(#pane)" stroke="#56e6ff" stroke-opacity=".5"/><rect x="201" y="80" width="118" height="260" rx="22" fill="url(#pane)" stroke="#ffe34b" stroke-opacity=".6"/><rect x="360" y="80" width="118" height="260" rx="22" fill="url(#pane)" stroke="#ff7b6d" stroke-opacity=".55"/>
      <text class="diagram-label" x="65" y="114">SOURCE</text><text class="diagram-label" x="220" y="114">INTERFACE</text><text class="diagram-label" x="380" y="114">IMAGE</text>
      <g filter="url(#glow)"><circle class="node cyan" cx="101" cy="210" r="31"/><polygon points="260,169 296,231 224,231" fill="#ffe34b"/><rect x="402" y="177" width="34" height="66" rx="17" fill="#ff7b6d"/></g>
      <path class="route yellow" d="M160 210 H201"/><path class="route coral" d="M319 210 H360"/><text class="diagram-small" x="178" y="193">TRANSLATE</text><text class="diagram-small" x="334" y="193">RENDER</text></g>`, "Information changing form as it crosses interfaces");

    if (mode === "localization") return baseSvg(`<g class="float-group"><circle class="orbit dash" cx="260" cy="210" r="170"/><circle class="orbit" cx="260" cy="210" r="126"/><circle class="orbit" cx="260" cy="210" r="83"/><circle class="halo" cx="260" cy="210" r="75"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="260" cy="210" r="61" opacity=".3"/><circle class="node yellow" cx="260" cy="210" r="29"/></g>
      <text class="diagram-label" x="197" y="205">LOCAL</text><text class="diagram-label" x="201" y="224">PERSON</text><text class="diagram-small" x="205" y="49">PERSISTENT PATTERN</text><text class="diagram-small" x="295" y="300">FINITE INTERFACE</text>
      <path class="route coral" d="M325 283 C359 321 394 331 430 324"/><circle class="node coral" cx="437" cy="323" r="8"/></g>`, "A persistent pattern localized through a finite interface");

    if (mode === "continuity") return baseSvg(`<g class="float-group"><path class="route" d="M88 210 C88 86 252 91 260 210 C268 329 432 334 432 210 C432 86 268 91 260 210 C252 329 88 334 88 210"/>
      <g filter="url(#glow)"><circle class="node cyan" cx="88" cy="210" r="21"/><circle class="node yellow" cx="260" cy="210" r="32"/><circle class="node lime" cx="432" cy="210" r="21"/></g><circle class="halo" cx="260" cy="210" r="64"/><text class="diagram-small" x="54" y="257">BEFORE</text><text class="diagram-label" x="217" y="267">EXPERIENCE</text><text class="diagram-small" x="403" y="257">AFTER</text></g>`, "Continuity passing through finite experience");

    if (mode === "routes") return baseSvg(`
      <g class="routes"><path class="route" d="M58 302 C142 103 337 77 465 167"/><path class="route lime" d="M58 302 C218 343 355 330 465 167"/><path class="route coral" d="M58 302 C167 241 238 213 336 239"/></g>
      <g filter="url(#glow)"><circle class="node yellow" cx="58" cy="302" r="27"/><circle class="node yellow" cx="465" cy="167" r="22"/></g>
      <g stroke="#ff7b6d" stroke-width="4"><line x1="329" y1="231" x2="345" y2="247"/><line x1="345" y1="231" x2="329" y2="247"/></g>
      <text class="diagram-label" x="30" y="352">REQUEST</text><text class="diagram-label" x="407" y="126">ARRIVAL</text>
      <text class="diagram-small" x="218" y="91">CANDIDATE ROUTE</text><text class="diagram-small" x="211" y="364">COMPATIBLE PATH</text><text class="diagram-small" x="281" y="275">BOUNDARY STOP</text>`, "Candidate transit routes with one compatible path and one boundary stop");

    if (mode === "signal") return baseSvg(`<g class="float-group"><circle class="orbit" cx="260" cy="210" r="62"/><circle class="orbit dash" cx="260" cy="210" r="116"/><circle class="orbit" cx="260" cy="210" r="168"/><g filter="url(#glow)"><circle class="node yellow" cx="260" cy="210" r="38"/><circle class="node coral" cx="90" cy="313" r="13"/><circle class="node cyan" cx="431" cy="114" r="14"/></g><path class="route" d="M283 186 C336 130 377 132 431 114"/><path class="route coral" d="M228 232 C183 269 139 281 90 313"/><text class="diagram-label" x="224" y="218">TERRA</text><text class="diagram-small" x="367" y="90">OUTBOUND</text><text class="diagram-small" x="48" y="344">INBOUND</text></g>`, "Outbound and inbound signals crossing between Terra and observers");

    if (mode === "terra") return baseSvg(`<g><ellipse class="orbit" cx="260" cy="210" rx="198" ry="84"/><ellipse class="orbit" cx="260" cy="210" rx="150" ry="136" transform="rotate(-26 260 210)"/><g filter="url(#glow)"><circle class="node yellow" cx="260" cy="210" r="45"/><circle class="node cyan" cx="65" cy="210" r="12"/><circle class="node lime" cx="370" cy="99" r="14"/><circle class="node coral" cx="413" cy="264" r="12"/></g></g><text class="diagram-label" x="218" y="216">TERRA</text><text class="diagram-small" x="33" y="187">OBSERVATION</text><text class="diagram-small" x="342" y="72">MODEL REVISION</text><text class="diagram-small" x="373" y="299">LOCAL ANOMALY</text>`, "Observation of Terra being revised by unfamiliar local details");

    if (mode === "principles") return baseSvg(`<g class="float-group"><path class="route" d="M260 210 L113 210 M260 210 L407 210 M260 210 L260 357"/><circle class="orbit" cx="260" cy="210" r="147"/><circle class="orbit" cx="260" cy="210" r="91"/><g filter="url(#glow)"><circle class="node yellow" cx="260" cy="210" r="31"/><circle class="node lime" cx="407" cy="210" r="15"/><circle class="node coral" cx="260" cy="357" r="15"/><circle class="node cyan" cx="113" cy="210" r="15"/></g><text class="diagram-label" x="221" y="216">EQUALITY</text><text class="diagram-small" x="421" y="214">RELATION</text><text class="diagram-small" x="218" y="391">LIMITS</text><text class="diagram-small" x="41" y="214">PERSPECTIVE</text></g>`, "Equality at the center of perspective, relation, and limits");

    return baseSvg(`<g class="float-group"><circle class="orbit" cx="260" cy="210" r="160"/><circle class="orbit" cx="260" cy="210" r="105"/><path class="route lime" d="M281 191 C310 164 327 144 351 124"/><g filter="url(#glow)"><circle class="node yellow" cx="260" cy="210" r="38"/><circle class="node cyan" cx="101" cy="210" r="15"/><circle class="node lime" cx="351" cy="124" r="14"/><circle class="node cyan" cx="397" cy="273" r="13"/></g><text class="diagram-label" x="216" y="216">TERRA</text><text class="diagram-small" x="45" y="190">OTHER PERSPECTIVE</text><text class="diagram-small" x="329" y="98">NEW CONNECTION</text><text class="diagram-small" x="372" y="304">OTHER PERSPECTIVE</text></g>`, "Terra forming a new connection within a larger field of perspectives");
  }

  function renderVisual(section) {
    const mode = modeFor(section);
    const [kicker, title, caption, legend] = visualCopy[mode];
    els.visualKicker.textContent = kicker;
    els.visualTitle.textContent = title;
    els.visualCaption.textContent = caption;
    els.visualLegend.innerHTML = legend.map(([color, text]) => `<span><i class="dot-${color}"></i>${text}</span>`).join("");
    els.diagram.innerHTML = diagramMarkup(mode);
    els.diagram.dataset.mode = mode;
  }

  function render({ focus = false } = {}) {
    const section = sections[state.index];
    stopNarration();
    els.label.textContent = section.label;
    els.title.textContent = section.title;
    renderBlocks(section);
    renderVisual(section);
    document.title = `${section.title} · ${book.meta.title}`;
    els.content.scrollTop = 0;
    if (focus) els.content.focus({ preventScroll: true });

    els.list.querySelectorAll("li").forEach((item, index) => item.classList.toggle("current", index === state.index));
    const currentItem = els.list.querySelector(`li[data-index="${state.index}"]`);
    currentItem?.scrollIntoView({ block: "nearest", inline: "nearest" });

    const progress = Math.round((state.index / (sections.length - 1)) * 100);
    els.progress.style.width = `${progress}%`;
    els.progressBar.setAttribute("aria-valuenow", String(progress));
    els.progressPercent.textContent = `${progress}%`;
    els.progressLabel.textContent = section.id === "appendix" ? "Reference appendix" : section.label;
    els.counter.textContent = section.id === "introduction" ? "Intro / 43" : section.id === "appendix" ? "Appendix" : section.number ? `${section.number} / 43` : section.label;
    const narrationAvailable = section.narration !== false;
    els.listen.disabled = !narrationAvailable;
    els.play.disabled = !narrationAvailable;
    els.listen.setAttribute("aria-label", narrationAvailable ? "Play Exi narration" : "Narration unavailable for this chapter");
    els.play.setAttribute("aria-label", narrationAvailable ? "Play Exi narration" : "Narration unavailable for this chapter");
    els.previous.disabled = state.index === 0;
    els.next.disabled = state.index === sections.length - 1;
    syncBookmarkButtons();
    storage.write("leth-last-section", section.id);
  }

  function navigate(index, { focus = false, replace = false } = {}) {
    const bounded = Math.max(0, Math.min(sections.length - 1, index));
    state.index = bounded;
    const hash = `#${sections[bounded].id}`;
    if (replace) history.replaceState(null, "", hash); else if (location.hash !== hash) history.pushState(null, "", hash);
    render({ focus });
  }

  function indexFromLocation() {
    const id = location.hash.slice(1) || storage.read("leth-last-section", "introduction");
    const index = sections.findIndex((section) => section.id === id);
    return index < 0 ? 0 : index;
  }

  function refreshBookmarks() {
    els.list.querySelectorAll("li").forEach((item, index) => {
      const indicator = item.querySelector(".bookmark-indicator");
      if (indicator) indicator.hidden = !state.bookmarks.has(sections[index].id);
    });
    const count = state.bookmarks.size;
    els.bookmarkCount.textContent = `${count} bookmark${count === 1 ? "" : "s"}`;
  }

  function syncBookmarkButtons() {
    const selected = state.bookmarks.has(sections[state.index].id);
    [els.bookmark, els.inlineBookmark].forEach((button) => button.setAttribute("aria-pressed", String(selected)));
  }

  function toggleBookmark() {
    const id = sections[state.index].id;
    if (state.bookmarks.has(id)) {
      state.bookmarks.delete(id);
      notify("Bookmark removed");
    } else {
      state.bookmarks.add(id);
      notify("Chapter bookmarked");
    }
    storage.write("leth-bookmarks", [...state.bookmarks]);
    refreshBookmarks();
    syncBookmarkButtons();
  }

  let toastTimer;
  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function buildSearch() {
    if (state.searchBuilt) return;
    const list = document.createElement("ol");
    list.className = "search-results";
    list.id = "search-results";
    els.searchDialog.querySelector("form").append(list);
    state.searchBuilt = true;
  }

  function runSearch(query) {
    const normalized = query.trim().toLowerCase();
    const results = $("#search-results");
    results.replaceChildren();
    if (!normalized) {
      els.searchStatus.textContent = "Search chapter titles and full text.";
      return;
    }
    const matches = sections.filter((section) => {
      const text = `${section.label} ${section.title} ${section.blocks.map((block) => plain(block.html)).join(" ")}`.toLowerCase();
      return text.includes(normalized);
    }).slice(0, 20);
    els.searchStatus.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
    for (const section of matches) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const body = section.blocks.map((block) => plain(block.html)).join(" ");
      const at = body.toLowerCase().indexOf(normalized);
      const excerpt = at < 0 ? body.slice(0, 130) : body.slice(Math.max(0, at - 45), at + normalized.length + 85);
      const title = document.createElement("strong");
      title.textContent = `${section.label}: ${section.title}`;
      const copy = document.createElement("span");
      copy.textContent = `${at > 45 ? "…" : ""}${excerpt}${excerpt.length < body.length ? "…" : ""}`;
      button.append(title, copy);
      button.addEventListener("click", () => {
        els.searchDialog.close();
        navigate(sections.indexOf(section), { focus: true });
      });
      item.append(button);
      results.append(item);
    }
  }

  function openSearch() {
    buildSearch();
    els.searchDialog.showModal();
    els.searchInput.value = "";
    runSearch("");
    requestAnimationFrame(() => els.searchInput.focus());
  }

  function updateNarrationControls(playing = false) {
    document.body.classList.toggle("narration-playing", playing);
    els.read.setAttribute("aria-pressed", "true");
    els.read.classList.add("active");
    els.listen.setAttribute("aria-pressed", String(playing));
    els.listen.classList.toggle("active", playing);
    els.listen.setAttribute("aria-label", playing ? "Pause Exi narration" : "Play Exi narration");
    els.play.setAttribute("aria-label", playing ? "Pause Exi narration" : "Play Exi narration");
    els.play.querySelector(".play-label").textContent = playing ? "Pause narration" : "Play narration";
    els.play.querySelector("span").textContent = playing ? "❚❚" : "▶";
  }

  function stopNarration({ savePosition = true } = {}) {
    if (savePosition) saveNarrationPosition();
    narration.pause();
    if (narration.readyState > HTMLMediaElement.HAVE_NOTHING) {
      try { narration.currentTime = 0; } catch { /* Mobile browsers may not expose a seekable range yet. */ }
    }
    state.narrationSection = null;
    state.narrationPart = 0;
    updateNarrationControls(false);
  }

  function narrationProgressKey(sectionId) {
    return `leth-narration-progress-${sectionId}`;
  }

  function narrationSource(section, part = 0) {
    const filename = section.narrationParts
      ? `${section.id}-part-${String(part).padStart(2, "0")}.mp3`
      : `${section.id}.mp3`;
    return new URL(`audio/${filename}?v=20260920-1`, document.baseURI).href;
  }

  function saveNarrationPosition() {
    if (!state.narrationSection || !Number.isFinite(narration.currentTime)) return;
    const second = Math.floor(narration.currentTime);
    if (second === state.narrationSavedSecond) return;
    state.narrationSavedSecond = second;
    storage.write(narrationProgressKey(state.narrationSection), { part: state.narrationPart, time: narration.currentTime });
  }

  function loadNarrationPart(section, part, resumeAt = 0) {
    state.narrationSection = section.id;
    state.narrationPart = part;
    state.narrationSavedSecond = -1;
    narration.src = narrationSource(section, part);
    if (resumeAt > 0) {
      narration.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(narration.duration)) narration.currentTime = Math.min(resumeAt, Math.max(0, narration.duration - .25));
      }, { once: true });
    }
    narration.load();
  }

  async function toggleNarration() {
    const section = sections[state.index];
    if (section.narration === false) {
      notify("The Exi narration is unavailable for this entry.");
      return;
    }
    if (state.narrationSection === section.id && !narration.paused) {
      narration.pause();
      updateNarrationControls(false);
      return;
    }
    if (state.narrationSection !== section.id) {
      const saved = storage.read(narrationProgressKey(section.id), null);
      const partCount = section.narrationParts || 1;
      const part = Number.isInteger(saved?.part) && saved.part >= 0 && saved.part < partCount ? saved.part : 0;
      const resumeAt = Number.isFinite(saved?.time) && saved.time > 0 ? saved.time : 0;
      loadNarrationPart(section, part, resumeAt);
    }
    try {
      await narration.play();
      updateNarrationControls(true);
    } catch (error) {
      updateNarrationControls(false);
      state.narrationSection = null;
      notify(error?.name === "NotAllowedError" ? "Tap Listen again to allow narration." : "The Exi narration could not be loaded.");
    }
  }

  narration.addEventListener("timeupdate", saveNarrationPosition);
  narration.addEventListener("ended", async () => {
    const section = sections.find((entry) => entry.id === state.narrationSection);
    const partCount = section?.narrationParts || 1;
    if (section && state.narrationPart + 1 < partCount) {
      loadNarrationPart(section, state.narrationPart + 1);
      try {
        await narration.play();
        updateNarrationControls(true);
      } catch {
        updateNarrationControls(false);
        notify("Tap Play narration to continue.");
      }
      return;
    }
    if (section) localStorage.removeItem(narrationProgressKey(section.id));
    stopNarration({ savePosition: false });
  });
  narration.addEventListener("error", () => {
    saveNarrationPosition();
    state.narrationSection = null;
    updateNarrationControls(false);
    notify("Narration paused. Tap Play narration to resume.");
  });
  window.addEventListener("pagehide", saveNarrationPosition);

  function applySettings() {
    document.body.classList.toggle("font-small", state.font === "small");
    document.body.classList.toggle("font-large", state.font === "large");
    document.body.classList.toggle("high-contrast", state.highContrast);
    document.body.classList.toggle("quiet", state.quiet);
    document.body.classList.toggle("motion-paused", !state.motion);
    settings.querySelectorAll("[data-font]").forEach((button) => button.classList.toggle("selected", button.dataset.font === state.font));
    $("#contrast-toggle").checked = state.highContrast;
    $("#quiet-toggle").checked = state.quiet;
    els.motionToggle.setAttribute("aria-pressed", String(state.motion));
    els.motionToggle.lastChild.textContent = state.motion ? " Motion on" : " Motion off";
  }

  function toggleSettings(force) {
    settings.hidden = typeof force === "boolean" ? !force : !settings.hidden;
    const open = !settings.hidden;
    els.settingsButton.setAttribute("aria-expanded", String(open));
    if (open) $("#settings-close").focus();
  }

  function toggleMotion() {
    state.motion = !state.motion;
    storage.write("leth-motion", state.motion);
    applySettings();
  }

  function addPressFeedback() {
    document.addEventListener("pointerup", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      button.animate([{ transform: "translateY(1px) scale(.98)" }, { transform: "translateY(0) scale(1)" }], { duration: 180, easing: "ease-out" });
    });
  }

  els.previous.addEventListener("click", () => navigate(state.index - 1, { focus: true }));
  els.next.addEventListener("click", () => navigate(state.index + 1, { focus: true }));
  els.home.addEventListener("click", () => navigate(0, { focus: true }));
  els.read.addEventListener("click", () => { stopNarration(); els.content.focus({ preventScroll: true }); });
  els.bookmark.addEventListener("click", toggleBookmark);
  els.inlineBookmark.addEventListener("click", toggleBookmark);
  els.listen.addEventListener("click", toggleNarration);
  els.play.addEventListener("click", toggleNarration);
  els.searchButton.addEventListener("click", openSearch);
  els.searchInput.addEventListener("input", (event) => runSearch(event.target.value));
  els.settingsButton.addEventListener("click", () => toggleSettings());
  $("#settings-close").addEventListener("click", () => toggleSettings(false));
  settings.querySelectorAll("[data-font]").forEach((button) => button.addEventListener("click", () => {
    state.font = button.dataset.font;
    storage.write("leth-font", state.font);
    applySettings();
  }));
  $("#contrast-toggle").addEventListener("change", (event) => { state.highContrast = event.target.checked; storage.write("leth-contrast", state.highContrast); applySettings(); });
  $("#quiet-toggle").addEventListener("change", (event) => { state.quiet = event.target.checked; storage.write("leth-quiet", state.quiet); applySettings(); });
  els.motionToggle.addEventListener("click", toggleMotion);
  els.railToggle.addEventListener("click", () => {
    const collapsed = els.shell.classList.toggle("rail-collapsed");
    els.railToggle.setAttribute("aria-expanded", String(!collapsed));
    els.railToggle.setAttribute("aria-label", collapsed ? "Expand contents" : "Collapse contents");
  });
  els.fullscreen.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await els.shell.requestFullscreen(); else await document.exitFullscreen();
    } catch { notify("Full screen is not available here"); }
  });
  window.addEventListener("popstate", () => { state.index = indexFromLocation(); render(); });
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea") || els.searchDialog.open) return;
    if (event.key === "ArrowLeft") navigate(state.index - 1, { focus: true });
    if (event.key === "ArrowRight") navigate(state.index + 1, { focus: true });
    if (event.key === "/") { event.preventDefault(); openSearch(); }
    if (event.key === "Escape" && !settings.hidden) toggleSettings(false);
  });
  document.addEventListener("click", (event) => {
    if (!settings.hidden && !settings.contains(event.target) && !els.settingsButton.contains(event.target)) toggleSettings(false);
  });

  buildNavigation();
  applySettings();
  addPressFeedback();
  state.index = indexFromLocation();
  navigate(state.index, { replace: true });
})();
