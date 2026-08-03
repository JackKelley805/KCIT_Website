const navItems = [
  { id: "home", label: "Home", href: "/" },
  { id: "business-it", label: "Business IT", href: "/business-it" },
  { id: "managed-networks", label: "Managed Networks", href: "/managed-networks" },
  { id: "contact", label: "Contact", href: "/contact" }
];

function injectSiteChrome() {
  const page = document.body.dataset.page || "home";
  const headerTarget = document.querySelector("[data-site-header]");
  const footerTarget = document.querySelector("[data-site-footer]");
  const isRestrictedPage = page === "development" || page === "development-contact";
  const navLinks = navItems
    .map((item) => {
      const activeClass = item.id === page ? " is-active" : "";
      return `<a class="nav-link${activeClass}" href="${item.href}">${item.label}</a>`;
    })
    .join("");

  if (headerTarget) {
    if (isRestrictedPage) {
      headerTarget.innerHTML = `
        <header class="site-header">
          <div class="site-header__inner site-header__inner--development">
            <div class="brand brand--centered">
              <span class="brand__logo-wrap">
                <img class="brand__logo" src="assets/kc_logo.png" alt="Kelley Computers logo">
              </span>
              <span class="brand__text brand__text--centered">
                <strong>Kelley Computers</strong>
                <small>Business IT and managed networks</small>
              </span>
            </div>
          </div>
        </header>
      `;
    } else {
      headerTarget.innerHTML = `
        <header class="site-header">
          <div class="site-header__inner">
            <a class="brand" href="/" aria-label="Kelley Computers home">
              <span class="brand__logo-wrap">
                <img class="brand__logo" src="assets/kc_logo.png" alt="Kelley Computers logo">
              </span>
              <span class="brand__text">
                <strong>Kelley Computers</strong>
                <small>Business IT and managed networks</small>
              </span>
            </a>
            <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <nav class="site-nav" id="site-nav" aria-label="Primary">
              ${navLinks}
            </nav>
          </div>
        </header>
      `;
    }
  }

  if (footerTarget) {
    if (isRestrictedPage) {
      footerTarget.innerHTML = `
        <footer class="site-footer">
          <div class="site-footer__inner site-footer__inner--development">
            <div class="footer-copy footer-copy--development">
              <strong>Kelley Computers</strong>
              <span>Basic business IT support and managed networks.</span>
              <span>&copy; ${new Date().getFullYear()}</span>
            </div>
          </div>
        </footer>
      `;
    } else {
      footerTarget.innerHTML = `
        <footer class="site-footer">
          <div class="site-footer__inner">
            <div class="footer-copy">
              <strong>Kelley Computers </strong>
              <span>Basic business IT support and managed networks.</span>
            </div>
            <div class="footer-links">
              <span>&copy; ${new Date().getFullYear()}</span>
              <a href="/business-it">Business IT</a>
              <a href="/managed-networks">Managed Networks</a>
              <a href="/contact">Contact</a>
            </div>
          </div>
        </footer>
      `;
    }
  }
}

function setupNavigation() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  const header = document.querySelector(".site-header__inner");

  if (!toggle || !nav || !header) {
    return;
  }

  const closeNav = () => {
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const nextState = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", nextState);
    toggle.setAttribute("aria-expanded", String(nextState));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNav);
  });

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("nav-open")) {
      return;
    }

    if (!header.contains(event.target)) {
      closeNav();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNav();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) {
      closeNav();
    }
  });
}

function setupContactForm() {
  const form = document.querySelector("[data-contact-form]");
  const status = document.querySelector("[data-form-status]");

  if (!form || !status) {
    return;
  }

  const storageKey = "kcit-contact-draft";
  const fields = Array.from(form.querySelectorAll("input, select, textarea"));
  const savedValues = loadSavedDraft(storageKey);

  fields.forEach((field) => {
    if (savedValues[field.name]) {
      field.value = savedValues[field.name];
    }

    setupPhoneFormatting(field);

    field.addEventListener("input", () => saveDraft(storageKey, fields));
    field.addEventListener("change", () => saveDraft(storageKey, fields));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!form.reportValidity()) {
      return;
    }

    submitContactForm({ form, status, storageKey });
  });
}

function setupPhoneFormatting(field) {
  if (!field || field.name !== "phone") {
    return;
  }

  const formatValue = () => {
    const selectionStart = typeof field.selectionStart === "number"
      ? field.selectionStart
      : field.value.length;
    const digitsBeforeCursor = getDigitCount(field.value.slice(0, selectionStart));
    const formattedValue = formatPhoneNumber(field.value);

    field.value = formattedValue;

    if (document.activeElement === field && typeof field.setSelectionRange === "function") {
      const nextCursor = getCursorFromDigitCount(formattedValue, digitsBeforeCursor);
      field.setSelectionRange(nextCursor, nextCursor);
    }
  };

  formatValue();
  field.addEventListener("input", formatValue);
  field.addEventListener("blur", formatValue);
}

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (!digits) {
    return "";
  }

  if (digits.length < 4) {
    return `(${digits}`;
  }

  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function getDigitCount(value) {
  return (value.match(/\d/g) || []).length;
}

function getCursorFromDigitCount(value, digitCount) {
  if (!digitCount) {
    return 0;
  }

  let digitsSeen = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      digitsSeen += 1;

      if (digitsSeen >= digitCount) {
        return index + 1;
      }
    }
  }

  return value.length;
}

async function submitContactForm({ form, status, storageKey }) {
  const data = new FormData(form);
  const payload = {
    page: document.body.dataset.page || "website",
    name: (data.get("name") || "").toString().trim(),
    occupation: (data.get("occupation") || "").toString().trim(),
    phone: (data.get("phone") || "").toString().trim(),
    company: (data.get("company") || "").toString().trim(),
    service: (data.get("service") || "").toString().trim(),
    notes: (data.get("notes") || "").toString().trim()
  };

  setFormStatus(status, "pending", "Saving request...");

  try {
    await postContactPayload(payload);

    setFormStatus(
      status,
      "success",
      "Request saved.",
      `${payload.name} | ${payload.occupation} | ${payload.phone}<br>We will follow up soon.`
    );

    form.reset();
    localStorage.removeItem(storageKey);
  } catch (error) {
    setFormStatus(
      status,
      "error",
      "Request was not saved.",
      "Make sure this website can reach /api/contact."
    );
  }
}

async function postContactPayload(payload) {
  const endpoints = getContactApiEndpoints();
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to save request.");
      }

      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach a contact save endpoint.");
}

function getContactApiEndpoints() {
  const endpoints = [];
  const currentUrl = window.location.href;
  const currentOrigin = window.location.origin;
  const isFileProtocol = window.location.protocol === "file:";
  const configuredEndpoint = getConfiguredContactApiEndpoint();
  const isLocalEnvironment = isFileProtocol || isLocalHost(window.location.hostname);

  pushHttpEndpoint(endpoints, configuredEndpoint, currentUrl);
  pushHttpEndpoint(endpoints, getApiUrlForOrigin(currentOrigin), currentUrl);

  if (isLocalEnvironment && window.location.hostname) {
    pushHttpEndpoint(
      endpoints,
      `${window.location.protocol}//${window.location.hostname}:3000/api/contact`,
      currentUrl
    );
  }

  if (isLocalEnvironment) {
    pushHttpEndpoint(endpoints, "https://kelleycomputers-it.com/api/contact", currentUrl);
    pushHttpEndpoint(endpoints, "https://www.kelleycomputers-it.com/api/contact", currentUrl);
    pushHttpEndpoint(endpoints, "http://localhost:3000/api/contact", currentUrl);
    pushHttpEndpoint(endpoints, "http://127.0.0.1:3000/api/contact", currentUrl);
  }

  return endpoints;
}

function getConfiguredContactApiEndpoint() {
  const bodyValue = document.body?.dataset.contactApiEndpoint?.trim();
  const metaValue = document
    .querySelector('meta[name="contact-api-endpoint"]')
    ?.getAttribute("content")
    ?.trim();

  return bodyValue || metaValue || "";
}

function getApiUrlForOrigin(origin) {
  if (!origin || origin === "null" || window.location.protocol === "file:") {
    return "";
  }

  try {
    return new URL("/api/contact", origin).toString();
  } catch (error) {
    return "";
  }
}

function pushHttpEndpoint(endpoints, endpoint, currentUrl) {
  if (!endpoint) {
    return;
  }

  try {
    const parsedUrl = new URL(endpoint, currentUrl);

    if (!parsedUrl.protocol.startsWith("http")) {
      return;
    }

    const normalizedUrl = parsedUrl.toString();

    if (!endpoints.includes(normalizedUrl)) {
      endpoints.push(normalizedUrl);
    }
  } catch (error) {
    // Ignore invalid endpoint candidates.
  }
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function loadSavedDraft(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch (error) {
    return {};
  }
}

function saveDraft(storageKey, fields) {
  const draft = fields.reduce((accumulator, field) => {
    if (field.name) {
      accumulator[field.name] = field.value;
    }
    return accumulator;
  }, {});

  localStorage.setItem(storageKey, JSON.stringify(draft));
}

function setFormStatus(status, state, title, message = "") {
  status.hidden = false;
  status.dataset.state = state;
  status.innerHTML = `<strong>${title}</strong>${message ? `<span>${message}</span>` : ""}`;
}

function setupScrollFade() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = Array.from(document.querySelectorAll([
    ".hero-copy",
    ".page-hero-copy",
    ".section-heading",
    ".service-card",
    ".offset-strip",
    ".simple-card",
    ".cta-panel",
    ".contact-form"
  ].join(", ")));

  if (!targets.length) {
    return;
  }

  if (reducedMotion || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-visible", entry.isIntersecting);
      });
    },
    {
      threshold: 0.22,
      rootMargin: "-8% 0px -10% 0px"
    }
  );

  targets.forEach((target) => {
    target.setAttribute("data-scroll-fade", "");
    observer.observe(target);
  });
}

function setupInteractiveBackground() {
  const canvas = document.querySelector(".site-canvas");

  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };
  let width = window.innerWidth;
  let height = window.innerHeight;
  let animationFrame = 0;
  let particles = [];

  const particleCount = () => {
    const area = width * height;
    return Math.max(60, Math.min(220, Math.floor(area / 8000)));
  };

  const createParticle = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    radius: Math.random() * 1.5 + 1,
    tone: Math.random() > 0.86 ? (Math.random() > 0.5 ? "blue" : "yellow") : "white"
  });

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: particleCount() }, createParticle);
  };

  const drawFrame = () => {
    context.clearRect(0, 0, width, height);

    particles.forEach((particle) => {
      if (pointer.active) {
        const dx = particle.x - pointer.x;
        const dy = particle.y - pointer.y;
        const distance = Math.hypot(dx, dy) || 1;

        if (distance < 220) {
          const force = (220 - distance) / 4500;
          particle.vx += (dx / distance) * force;
          particle.vy += (dy / distance) * force;
        }
      }

      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.998;
      particle.vy *= 0.998;

      if (particle.x < -20 || particle.x > width + 20) {
        particle.vx *= -1;
      }

      if (particle.y < -20 || particle.y > height + 20) {
        particle.vy *= -1;
      }
    });

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];

      for (let next = index + 1; next < particles.length; next += 1) {
        const partner = particles[next];
        const dx = particle.x - partner.x;
        const dy = particle.y - partner.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 200) {
          const opacity = 1 - distance / 200;
          context.strokeStyle = connectionColor(particle.tone, partner.tone, opacity);
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(particle.x, particle.y);
          context.lineTo(partner.x, partner.y);
          context.stroke();
        }
      }

      context.fillStyle = particleColor(particle.tone);
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    animationFrame = window.requestAnimationFrame(drawFrame);
  };

  const handlePointerMove = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  };

  const deactivatePointer = () => {
    pointer.active = false;
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerleave", deactivatePointer);
  window.addEventListener("blur", deactivatePointer);

  if (reducedMotion) {
    drawFrame();
    window.cancelAnimationFrame(animationFrame);
  } else {
    drawFrame();
  }
}

function particleColor(tone) {
  if (tone === "blue") {
    return "rgba(46, 168, 255, 0.78)";
  }

  if (tone === "yellow") {
    return "rgba(243, 194, 51, 0.82)";
  }

  return "rgba(255, 255, 255, 0.42)";
}

function connectionColor(firstTone, secondTone, opacity) {
  const alpha = opacity * 0.15;

  if (firstTone === "blue" || secondTone === "blue") {
    return `rgba(46, 168, 255, ${alpha})`;
  }

  if (firstTone === "yellow" || secondTone === "yellow") {
    return `rgba(243, 194, 51, ${alpha})`;
  }

  return `rgba(255, 255, 255, ${alpha})`;
}

injectSiteChrome();
setupNavigation();
setupContactForm();
setupScrollFade();
setupInteractiveBackground();
