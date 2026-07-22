// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));

  /** Safely create an element with text content and optional class. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function clear() {
    while (app.firstChild) {
      app.removeChild(app.firstChild);
    }
  }

  function renderHeader() {
    const header = el("div", "cd-header");
    header.appendChild(el("span", "cd-title", "Clarity Diff"));
    return header;
  }

  function renderOnboarding() {
    const card = el("div", "cd-card");
    card.appendChild(el("h2", null, "Add your Grok API key"));
    card.appendChild(
      el("p", "cd-muted", "Clarity Diff uses Grok (xAI) to explain your changes. Your key is stored securely and never leaves your machine except to call xAI."),
    );
    const input = el("input", "cd-input");
    input.type = "password";
    input.placeholder = "xai-...";
    card.appendChild(input);
    const btn = el("button", "cd-btn cd-btn-primary", "Save key");
    btn.addEventListener("click", () => {
      const key = input.value.trim();
      if (key) {
        post({ type: "saveApiKey", key });
      }
    });
    card.appendChild(btn);
    const link = el("a", "cd-link", "Get a key from the xAI console");
    link.href = "https://console.x.ai";
    card.appendChild(link);
    return card;
  }

  function renderConsent() {
    const card = el("div", "cd-card");
    card.appendChild(el("h2", null, "One quick heads-up"));
    card.appendChild(
      el("p", "cd-muted", "To explain your changes, Clarity Diff sends the relevant code diff to xAI's Grok API. Obvious secrets are masked first. Continue?"),
    );
    const btn = el("button", "cd-btn cd-btn-primary", "I understand, continue");
    btn.addEventListener("click", () => post({ type: "giveConsent" }));
    card.appendChild(btn);
    return card;
  }

  function renderNoRepo() {
    const card = el("div", "cd-card");
    card.appendChild(el("h2", null, "No git repository found"));
    card.appendChild(
      el("p", "cd-muted", "Clarity Diff detects AI changes from your git working tree. Initialize git in this workspace to enable automatic explanations."),
    );
    return card;
  }

  function renderIntentBox(lastIntent) {
    const wrap = el("div", "cd-intent");
    wrap.appendChild(el("label", "cd-label", "What did you ask the AI to do? (optional)"));
    const input = el("textarea", "cd-textarea");
    input.value = lastIntent || "";
    input.placeholder = "e.g. Add a dark mode toggle to settings";
    input.addEventListener("change", () => post({ type: "setIntent", intent: input.value }));
    wrap.appendChild(input);
    return wrap;
  }

  function renderControls(autoDetect) {
    const bar = el("div", "cd-controls");
    const rerun = el("button", "cd-btn", "Re-run");
    rerun.addEventListener("click", () => post({ type: "rerun" }));
    bar.appendChild(rerun);

    const toggle = el("button", "cd-btn cd-btn-ghost", autoDetect ? "Auto: On" : "Auto: Off");
    toggle.addEventListener("click", () => post({ type: "toggleAutoDetect" }));
    bar.appendChild(toggle);
    return bar;
  }

  function renderIdle(view) {
    const container = el("div", "cd-view");
    container.appendChild(renderIntentBox(view.lastIntent));
    container.appendChild(renderControls(view.autoDetect));
    container.appendChild(
      el("p", "cd-muted cd-hint", view.autoDetect
        ? "Waiting for the AI to make a change. I'll explain it automatically."
        : "Automatic detection is off. Use Re-run to explain the latest change."),
    );
    return container;
  }

  function renderAnalyzing() {
    const container = el("div", "cd-view");
    const status = el("div", "cd-analyzing");
    status.appendChild(el("span", "cd-spinner"));
    status.appendChild(el("span", null, "Analyzing latest change…"));
    container.appendChild(status);
    return container;
  }

  function flagClass(status) {
    if (status === "green") {
      return "cd-flag cd-flag-green";
    }
    if (status === "red") {
      return "cd-flag cd-flag-red";
    }
    return "cd-flag cd-flag-unknown";
  }

  function riskClass(risk) {
    return "cd-risk cd-risk-" + (risk || "medium");
  }

  function renderResult(view) {
    const result = view.result;
    const exp = result.explanation;
    const container = el("div", "cd-view");
    container.appendChild(renderIntentBox(view.lastIntent));
    container.appendChild(renderControls(view.autoDetect));

    if (result.contextNote) {
      container.appendChild(el("p", "cd-muted cd-context-note", result.contextNote));
    }

    // Intent match flag.
    const intentLabel =
      exp.intentMatch.status === "green"
        ? "Matches what you asked"
        : exp.intentMatch.status === "red"
          ? "Red flag — different from what you asked"
          : "Intent unclear";
    const flag = el("div", flagClass(exp.intentMatch.status));
    flag.appendChild(el("strong", null, intentLabel));
    if (exp.intentMatch.reason) {
      flag.appendChild(el("p", "cd-flag-reason", exp.intentMatch.reason));
    }
    container.appendChild(flag);

    // Summary.
    container.appendChild(el("h3", "cd-section-title", "What changed"));
    container.appendChild(el("p", null, exp.summary));

    // Structure fit.
    if (exp.structureFit) {
      container.appendChild(el("h3", "cd-section-title", "How it fits your project"));
      container.appendChild(el("p", null, exp.structureFit));
    }

    // Safety.
    container.appendChild(el("h3", "cd-section-title", "What could break"));
    const risk = el("div", riskClass(exp.safety.risk));
    risk.textContent = "Risk: " + (exp.safety.risk || "medium");
    container.appendChild(risk);
    if (exp.safety.reasons.length > 0) {
      const ul = el("ul", "cd-list");
      exp.safety.reasons.forEach((r) => ul.appendChild(el("li", null, r)));
      container.appendChild(ul);
    }

    // Next steps.
    if (exp.nextSteps.length > 0) {
      container.appendChild(el("h3", "cd-section-title", "Next steps"));
      const ol = el("ol", "cd-list");
      exp.nextSteps.forEach((s) => ol.appendChild(el("li", null, s)));
      container.appendChild(ol);
    }

    // Jargon, explained.
    if (Array.isArray(exp.glossary) && exp.glossary.length > 0) {
      container.appendChild(el("h3", "cd-section-title", "Jargon, explained"));
      const dl = el("div", "cd-glossary");
      exp.glossary.forEach((g) => {
        const item = el("div", "cd-glossary-item");
        item.appendChild(el("span", "cd-term", g.term));
        item.appendChild(el("p", "cd-definition", g.definition));
        dl.appendChild(item);
      });
      container.appendChild(dl);
    }

    // Changed files.
    if (result.files.length > 0) {
      container.appendChild(el("h3", "cd-section-title", "Changed files"));
      const chips = el("div", "cd-chips");
      result.files.forEach((f) => {
        const chip = el("button", "cd-chip", f.path);
        chip.title = f.status;
        chip.addEventListener("click", () =>
          post({ type: "openFile", path: f.path, line: f.firstChangedLine }),
        );
        chips.appendChild(chip);
      });
      container.appendChild(chips);
    }

    // Notices.
    if (result.truncated || result.redacted) {
      const notes = [];
      if (result.redacted) {
        notes.push("Some secrets were masked before sending.");
      }
      if (result.truncated) {
        notes.push("The diff was large and was truncated.");
      }
      container.appendChild(el("p", "cd-muted cd-notice", notes.join(" ")));
    }

    return container;
  }

  function renderError(view) {
    const container = el("div", "cd-view");
    const card = el("div", "cd-card cd-error");
    card.appendChild(el("h3", null, "Something went wrong"));
    card.appendChild(el("p", null, view.message));
    container.appendChild(card);
    container.appendChild(renderControls(view.autoDetect));
    return container;
  }

  function render(view) {
    clear();
    app.appendChild(renderHeader());
    switch (view.kind) {
      case "onboarding":
        app.appendChild(renderOnboarding());
        break;
      case "consent":
        app.appendChild(renderConsent());
        break;
      case "noRepo":
        app.appendChild(renderNoRepo());
        break;
      case "idle":
        app.appendChild(renderIdle(view));
        break;
      case "analyzing":
        app.appendChild(renderAnalyzing());
        break;
      case "result":
        app.appendChild(renderResult(view));
        break;
      case "error":
        app.appendChild(renderError(view));
        break;
      default:
        break;
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "view") {
      render(message.view);
    }
  });

  post({ type: "ready" });
})();
