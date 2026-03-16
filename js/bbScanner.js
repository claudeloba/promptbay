// ── BB AI Scope Scanner — Browser Edition ─────────────────────────
// Ports bugbounty_ai_scanner.py to client-side JavaScript.
// All credentials are stored in localStorage. A CORS proxy is used
// to reach platform APIs from the browser.
// ──────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ─── AI / LLM Keyword Patterns ────────────────────────────────

  var AI_KEYWORDS = [
    'AI[/\\s]?ML\\s+Features?',
    '\\bAI\\s+Features?\\b',
    '\\bML\\s+Features?\\b',
    '\\bAI\\s+Scope\\b',
    'AI[-\\s]?Powered',
    '\\bGenAI\\b',
    'Generative\\s+AI',
    '\\bchatbot\\b',
    '\\bcopilot\\b',
    'AI\\s+Assistant',
    'AI\\s+Agent',
    '\\bLLM\\b',
    '\\bChatGPT\\b',
    '\\bOpenAI\\b',
    'GPT[-\\s]?[34o]+',
    'prompt\\s+injection',
    '\\bClaude\\s+AI\\b',
    '\\bGemini\\s+(AI|Pro|Ultra)\\b',
    '\\bBard\\s+AI\\b',
    '\\bAnthropic\\b',
    '\\bLlama\\s*[23]?\\b',
    '\\bMistral\\s*(AI)?\\b',
    '\\bRAG\\b',
    'vector\\s+database',
    'embedding\\s+model',
    'semantic\\s+search',
    'AI[-\\s]?powered\\s+(search|feature|assistant|tool)',
    'machine\\s+learning\\s+(model|feature|endpoint)',
    '\\bDeepSeek\\b',
    '\\bPerplexity\\s+AI\\b',
    '\\bCopilot\\s+(AI|feature|endpoint)\\b',
  ];

  var FALSE_POSITIVE_PHRASES = [
    'AI[- ]generated\\s+report',
    'AI\\s+slop',
    "don'?t\\s+(use|leak|submit|send).{0,30}(AI|ChatGPT|LLM|GPT)",
    '(using|use\\s+of)\\s+AI\\s+to\\s+(generate|write|create)',
    'hallucinated',
    'no\\s+AI[- ]generated',
    'automated\\s+(reports?|submissions?)',
    'AI[- ]assisted\\s+report',
    'do\\s+not\\s+use\\s+AI',
    'avoid\\s+(using\\s+)?AI',
    'prohibit.{0,20}AI',
    'banned?\\s+AI',
    'report\\s+quality',
    'AI[- ]written',
    'low[- ]quality\\s+AI',
    'spam.{0,20}AI',
  ];

  var KEYWORD_RE = new RegExp(
    AI_KEYWORDS.map(function (kw) { return '(?:' + kw + ')'; }).join('|'),
    'gi'
  );

  var FALSE_POS_RE = new RegExp(
    FALSE_POSITIVE_PHRASES.map(function (fp) { return '(?:' + fp + ')'; }).join('|'),
    'gi'
  );

  var AI_DOMAIN_RE = /\.ai\b/i;

  // ─── Helpers ──────────────────────────────────────────────────

  function stripHtml(text) {
    var el = document.createElement('div');
    el.innerHTML = text || '';
    return el.textContent || el.innerText || '';
  }

  function isFalsePositive(text, matchIndex, matchLen) {
    var start = Math.max(0, matchIndex - 200);
    var end = Math.min(text.length, matchIndex + matchLen + 200);
    var window = text.slice(start, end);
    FALSE_POS_RE.lastIndex = 0;
    return FALSE_POS_RE.test(window);
  }

  function findAIKeywords(text) {
    var matched = [];
    var seen = {};
    var m;
    KEYWORD_RE.lastIndex = 0;
    while ((m = KEYWORD_RE.exec(text)) !== null) {
      if (!isFalsePositive(text, m.index, m[0].length)) {
        var kw = m[0].trim();
        var low = kw.toLowerCase();
        if (!seen[low]) {
          seen[low] = true;
          matched.push(kw);
        }
      }
    }
    return matched;
  }

  function hasAIDomain(identifier) {
    return AI_DOMAIN_RE.test(identifier);
  }

  function isoToMonth(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      var dt = new Date(dateStr);
      if (isNaN(dt.getTime())) return 'Unknown';
      var y = dt.getFullYear();
      var m = String(dt.getMonth() + 1).padStart(2, '0');
      return y + '-' + m;
    } catch (e) {
      return 'Unknown';
    }
  }

  function makeFinding(platform, programName, handle, date, kws, where, eligible, identifier) {
    return {
      platform: platform,
      program_name: programName,
      handle: handle,
      date_introduced: date || 'Unknown',
      keyword_matched: kws.join('; '),
      where: where,
      eligible_for_bounty: eligible != null ? eligible : '',
      scope_identifier: identifier || '',
    };
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ─── Fetch with CORS proxy, retries, rate-limit handling ──────

  async function apiFetch(url, options, proxyUrl, retries) {
    retries = retries || 3;
    var backoff = 5000;

    for (var attempt = 1; attempt <= retries; attempt++) {
      try {
        var fetchUrl = proxyUrl ? proxyUrl + encodeURIComponent(url) : url;
        var resp = await fetch(fetchUrl, options);

        if (resp.status === 429) {
          var wait = parseInt(resp.headers.get('Retry-After') || String(backoff * attempt / 1000), 10) * 1000;
          await sleep(wait);
          continue;
        }
        if (resp.status === 401) return null;
        if (resp.status === 404) return {};
        if (!resp.ok) return null;

        return await resp.json();
      } catch (e) {
        if (attempt < retries) {
          await sleep(backoff * attempt);
        }
      }
    }
    return null;
  }

  // ─── Platform Scanners ────────────────────────────────────────

  // ---------- HackerOne ----------
  var HackerOne = {
    name: 'HackerOne',
    rateDelay: 1200,
    base: 'https://api.hackerone.com/v1',

    getCredentials: function () {
      return {
        username: localStorage.getItem('bb_h1_username') || '',
        token: localStorage.getItem('bb_h1_token') || '',
      };
    },

    isAvailable: function () {
      var c = this.getCredentials();
      return !!(c.username && c.token);
    },

    getHeaders: function () {
      var c = this.getCredentials();
      return {
        'Authorization': 'Basic ' + btoa(c.username + ':' + c.token),
        'Accept': 'application/json',
      };
    },

    scanAll: async function (maxPages, proxyUrl, onProgress, signal) {
      var findings = [];
      var page = 1;
      var total = 0;

      while (true) {
        if (signal && signal.aborted) break;
        var data = await apiFetch(
          this.base + '/hackers/programs?page[number]=' + page + '&page[size]=100',
          { headers: this.getHeaders() },
          proxyUrl
        );
        var programs = (data || {}).data || [];
        if (!programs.length) break;

        for (var i = 0; i < programs.length; i++) {
          if (signal && signal.aborted) break;
          var attrs = programs[i].attributes || {};
          var handle = attrs.handle || '';
          var name = attrs.name || handle;
          if (!handle) continue;
          total++;
          if (onProgress) onProgress('[H1] [' + total + '] ' + name + ' (' + handle + ')');
          var pf = await this._scanProgram(handle, name, proxyUrl);
          findings = findings.concat(pf);
        }

        var links = (data || {}).links || {};
        if (!links.next) break;
        if (maxPages && page >= maxPages) break;
        page++;
        await sleep(this.rateDelay);
      }
      if (onProgress) onProgress('[H1] Scanned ' + total + ' programs.');
      return findings;
    },

    _scanProgram: async function (handle, name, proxyUrl) {
      var findings = [];

      // Policy text
      await sleep(this.rateDelay);
      var progData = await apiFetch(
        this.base + '/hackers/programs/' + handle,
        { headers: this.getHeaders() },
        proxyUrl
      ) || {};
      var attrs = ((progData.data || {}).attributes) || {};
      var policy = stripHtml(attrs.policy || attrs.policy_html || '');
      if (policy) {
        var kws = findAIKeywords(policy);
        if (kws.length) {
          findings.push(makeFinding('HackerOne', name, handle, 'Unknown', kws, 'Policy'));
        }
      }

      // Structured scopes
      await sleep(this.rateDelay);
      var scopesData = await apiFetch(
        this.base + '/hackers/programs/' + handle + '/structured_scopes',
        { headers: this.getHeaders() },
        proxyUrl
      ) || {};
      var items = scopesData.data || [];
      for (var i = 0; i < items.length; i++) {
        var a = items[i].attributes || {};
        var ident = a.asset_identifier || '';
        var instr = a.instruction || '';
        var atype = a.asset_type || '';
        var created = a.created_at;
        var eligible = a.eligible_for_bounty != null ? a.eligible_for_bounty : true;
        var text = ident + ' ' + instr;
        var kws = findAIKeywords(text);
        if (!kws.length && hasAIDomain(ident)) {
          kws = ['.ai domain (' + ident + ')'];
        }
        if (kws.length) {
          findings.push(makeFinding('HackerOne', name, handle, created, kws, 'Scope (' + atype + ')', eligible, ident));
        }
      }
      return findings;
    },
  };

  // ---------- Bugcrowd ----------
  var Bugcrowd = {
    name: 'Bugcrowd',
    rateDelay: 1100,
    base: 'https://api.bugcrowd.com',

    getCredentials: function () {
      return {
        username: localStorage.getItem('bb_bc_username') || '',
        token: localStorage.getItem('bb_bc_token') || '',
      };
    },

    isAvailable: function () {
      var c = this.getCredentials();
      return !!(c.username && c.token);
    },

    getHeaders: function () {
      var c = this.getCredentials();
      return {
        'Authorization': 'Token ' + c.username + ':' + c.token,
        'Accept': 'application/vnd.bugcrowd+json',
      };
    },

    scanAll: async function (maxPages, proxyUrl, onProgress, signal) {
      var findings = [];
      var offset = 0;
      var perPage = 25;
      var total = 0;

      while (true) {
        if (signal && signal.aborted) break;
        var params = 'page[limit]=' + perPage +
          '&page[offset]=' + offset +
          '&include=current_brief.target_groups.targets' +
          '&fields[program]=code,name,current_brief' +
          '&fields[program_brief]=target_groups' +
          '&fields[target_group]=name,targets' +
          '&fields[target]=name,uri,category,eligible_for_submission,created_at';

        var data = await apiFetch(
          this.base + '/programs?' + params,
          { headers: this.getHeaders() },
          proxyUrl
        ) || {};
        var programs = data.data || [];
        var includedMap = this._buildIncludedMap(data.included || []);

        if (!programs.length) break;

        for (var i = 0; i < programs.length; i++) {
          if (signal && signal.aborted) break;
          var progAttrs = programs[i].attributes || {};
          var handle = progAttrs.code || programs[i].id || '';
          var name = progAttrs.name || handle;
          total++;
          if (onProgress) onProgress('[BC] [' + total + '] ' + name);
          var pf = this._scanProgramData(programs[i], includedMap, handle, name);

          // Fetch policy text
          await sleep(this.rateDelay);
          var progDetail = await apiFetch(
            this.base + '/programs/' + handle + '?include=current_brief&fields[program_brief]=overview,in_scope,out_of_scope',
            { headers: this.getHeaders() },
            proxyUrl
          ) || {};
          var briefAttrs = {};
          (progDetail.included || []).forEach(function (inc) {
            if (inc.type === 'program_brief') briefAttrs = inc.attributes || {};
          });
          var policyText = Object.values(briefAttrs).filter(function (v) { return typeof v === 'string'; }).join(' ');
          policyText = stripHtml(policyText);
          if (policyText) {
            var kws = findAIKeywords(policyText);
            if (kws.length) {
              pf.push(makeFinding('Bugcrowd', name, handle, 'Unknown', kws, 'Policy'));
            }
          }
          findings = findings.concat(pf);
        }

        var links = data.links || {};
        if (!links.next) break;
        if (maxPages && (offset / perPage) + 1 >= maxPages) break;
        offset += perPage;
        await sleep(this.rateDelay);
      }
      if (onProgress) onProgress('[BC] Scanned ' + total + ' programs.');
      return findings;
    },

    _buildIncludedMap: function (included) {
      var m = {};
      included.forEach(function (item) {
        m[item.type + ':' + item.id] = item;
      });
      return m;
    },

    _scanProgramData: function (prog, included, handle, name) {
      var findings = [];
      var briefRel = ((prog.relationships || {}).current_brief || {}).data || {};
      var brief = included['program_brief:' + briefRel.id] || {};
      var tgRefs = (((brief.relationships || {}).target_groups || {}).data) || [];

      tgRefs.forEach(function (tgRef) {
        var tg = included['target_group:' + tgRef.id] || {};
        var targetRefs = (((tg.relationships || {}).targets || {}).data) || [];
        targetRefs.forEach(function (tRef) {
          var target = included['target:' + tRef.id] || {};
          var ta = target.attributes || {};
          var uri = ta.uri || ta.name || '';
          var cat = ta.category || '';
          var created = ta.created_at;
          var eligible = ta.eligible_for_submission != null ? ta.eligible_for_submission : true;
          var kws = findAIKeywords(uri);
          if (!kws.length && hasAIDomain(uri)) {
            kws = ['.ai domain (' + uri + ')'];
          }
          if (kws.length) {
            findings.push(makeFinding('Bugcrowd', name, handle, created, kws, 'Scope (' + cat + ')', eligible, uri));
          }
        });
      });
      return findings;
    },
  };

  // ---------- YesWeHack ----------
  var YesWeHack = {
    name: 'YesWeHack',
    rateDelay: 1000,
    base: 'https://api.yeswehack.com',

    getCredentials: function () {
      return { token: localStorage.getItem('bb_ywh_token') || '' };
    },

    isAvailable: function () {
      // Public programs work without creds
      return true;
    },

    getHeaders: function () {
      var c = this.getCredentials();
      var h = { 'Accept': 'application/json' };
      if (c.token) h['Authorization'] = 'Bearer ' + c.token;
      return h;
    },

    scanAll: async function (maxPages, proxyUrl, onProgress, signal) {
      var findings = [];
      var page = 1;
      var total = 0;

      while (true) {
        if (signal && signal.aborted) break;
        var data = await apiFetch(
          this.base + '/programs?page=' + page + '&nb_elements_per_page=50',
          { headers: this.getHeaders() },
          proxyUrl
        ) || {};
        var programs = data.items || [];
        if (!programs.length) break;

        for (var i = 0; i < programs.length; i++) {
          if (signal && signal.aborted) break;
          var slug = programs[i].slug || '';
          var name = programs[i].title || slug;
          total++;
          if (onProgress) onProgress('[YWH] [' + total + '] ' + name + ' (' + slug + ')');
          var pf = await this._scanProgram(slug, name, proxyUrl);
          findings = findings.concat(pf);
        }

        var pagination = data.pagination || {};
        var nbPages = pagination.nb_pages || 1;
        if (page >= nbPages) break;
        if (maxPages && page >= maxPages) break;
        page++;
        await sleep(this.rateDelay);
      }
      if (onProgress) onProgress('[YWH] Scanned ' + total + ' programs.');
      return findings;
    },

    _scanProgram: async function (slug, name, proxyUrl) {
      var findings = [];
      await sleep(this.rateDelay);
      var data = await apiFetch(
        this.base + '/programs/' + slug,
        { headers: this.getHeaders() },
        proxyUrl
      ) || {};

      // Policy fields
      ['guidelines', 'out_of_scope', 'description'].forEach(function (field) {
        var text = stripHtml(data[field] || '');
        if (text) {
          var kws = findAIKeywords(text);
          if (kws.length) {
            findings.push(makeFinding('YesWeHack', name, slug, 'Unknown', kws, 'Policy (' + field + ')'));
          }
        }
      });

      // Scope items
      (data.scopes || []).forEach(function (bucket) {
        var scopeType = bucket.scope_type || '';
        (bucket.scope || []).forEach(function (entry) {
          var ident = entry.scope || '';
          var desc = entry.description || '';
          var updated = data.updated_at || data.created_at;
          var eligible = !entry.out_of_scope;
          var text = ident + ' ' + desc;
          var kws = findAIKeywords(text);
          if (!kws.length && hasAIDomain(ident)) {
            kws = ['.ai domain (' + ident + ')'];
          }
          if (kws.length) {
            findings.push(makeFinding('YesWeHack', name, slug, updated, kws, 'Scope (' + scopeType + ')', eligible, ident));
          }
        });
      });
      return findings;
    },
  };

  // ---------- Intigriti ----------
  var Intigriti = {
    name: 'Intigriti',
    rateDelay: 500,
    base: 'https://api.intigriti.com/external/researcher/v1',

    getCredentials: function () {
      return { token: localStorage.getItem('bb_inti_token') || '' };
    },

    isAvailable: function () {
      var c = this.getCredentials();
      return !!c.token;
    },

    getHeaders: function () {
      var c = this.getCredentials();
      return {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/json',
      };
    },

    scanAll: async function (maxPages, proxyUrl, onProgress, signal) {
      var findings = [];
      var page = 1;
      var total = 0;

      while (true) {
        if (signal && signal.aborted) break;
        var data = await apiFetch(
          this.base + '/programs?pageNumber=' + page + '&pageSize=50',
          { headers: this.getHeaders() },
          proxyUrl
        ) || {};

        var programs, maxPage;
        if (Array.isArray(data)) {
          programs = data;
          maxPage = 1;
        } else {
          programs = data.records || data.data || [];
          maxPage = data.maxPageNumber || data.totalPages || 1;
        }
        if (!programs.length) break;

        for (var i = 0; i < programs.length; i++) {
          if (signal && signal.aborted) break;
          var progId = programs[i].id || '';
          var handle = programs[i].handle || progId;
          var name = programs[i].name || handle;
          var company = programs[i].companyHandle || '';
          total++;
          if (onProgress) onProgress('[INTI] [' + total + '] ' + name + ' (' + company + '/' + handle + ')');
          var pf = await this._scanProgram(company, handle, name, proxyUrl);
          findings = findings.concat(pf);
        }

        if (page >= maxPage) break;
        if (maxPages && page >= maxPages) break;
        page++;
        await sleep(this.rateDelay);
      }
      if (onProgress) onProgress('[INTI] Scanned ' + total + ' programs.');
      return findings;
    },

    _scanProgram: async function (company, handle, name, proxyUrl) {
      var findings = [];
      await sleep(this.rateDelay);

      var path = company
        ? this.base + '/programs/' + company + '/' + handle
        : this.base + '/programs/' + handle;
      var data = await apiFetch(path, { headers: this.getHeaders() }, proxyUrl) || {};

      // Policy text fields
      ['description', 'outOfScope', 'inScopeDescription'].forEach(function (field) {
        var text = stripHtml(data[field] || '');
        if (text) {
          var kws = findAIKeywords(text);
          if (kws.length) {
            findings.push(makeFinding('Intigriti', name, handle, 'Unknown', kws, 'Policy (' + field + ')'));
          }
        }
      });

      // In-scope domains
      var domains = data.domains || {};
      var inScope = Array.isArray(domains.inScope) ? domains.inScope : [];
      inScope.forEach(function (item) {
        var ident = item.endpoint || item.domain || '';
        var desc = item.description || '';
        var itypeRaw = item.type || {};
        var itype = typeof itypeRaw === 'object' ? (itypeRaw.value || '') : String(itypeRaw);
        var created = item.createdAt || item.addedAt;
        var bountyEligible = item.bounty != null ? item.bounty : true;
        var text = ident + ' ' + desc;
        var kws = findAIKeywords(text);
        if (!kws.length && hasAIDomain(ident)) {
          kws = ['.ai domain (' + ident + ')'];
        }
        if (kws.length) {
          findings.push(makeFinding('Intigriti', name, handle, created, kws, 'Scope (' + itype + ')', bountyEligible, ident));
        }
      });
      return findings;
    },
  };

  // ─── Main Scanner ─────────────────────────────────────────────

  var SCANNERS = {
    h1: HackerOne,
    bc: Bugcrowd,
    ywh: YesWeHack,
    inti: Intigriti,
  };

  /**
   * Run the scan across enabled platforms.
   * @param {Object} opts
   * @param {string[]} opts.platforms - e.g. ['h1','bc','ywh','inti']
   * @param {number}   opts.maxPages  - 0 = all
   * @param {string}   opts.proxyUrl  - CORS proxy base URL
   * @param {Function} opts.onProgress - called with log messages
   * @param {Function} opts.onFindings - called with (platformName, findings[]) after each platform
   * @param {AbortSignal} opts.signal - abort signal
   * @returns {Promise<Object[]>} all findings
   */
  async function scan(opts) {
    opts = opts || {};
    var platforms = opts.platforms || ['h1', 'bc', 'ywh', 'inti'];
    var maxPages = opts.maxPages || 0;
    var proxyUrl = opts.proxyUrl || '';
    var onProgress = opts.onProgress || function () {};
    var onFindings = opts.onFindings || function () {};
    var signal = opts.signal || null;

    var allFindings = [];

    for (var i = 0; i < platforms.length; i++) {
      var key = platforms[i];
      var scanner = SCANNERS[key];
      if (!scanner) continue;
      if (signal && signal.aborted) break;

      if (!scanner.isAvailable()) {
        onProgress('[' + scanner.name + '] Credentials not configured — skipping.');
        continue;
      }

      onProgress('━━━ Starting ' + scanner.name + ' scan ━━━');
      try {
        var findings = await scanner.scanAll(maxPages, proxyUrl, onProgress, signal);
        onProgress('[' + scanner.name + '] Found ' + findings.length + ' AI signal(s).');
        onFindings(scanner.name, findings);
        allFindings = allFindings.concat(findings);
      } catch (e) {
        onProgress('[' + scanner.name + '] Error: ' + (e.message || e));
      }
    }

    return allFindings;
  }

  /**
   * Export findings to CSV and download.
   */
  function exportCSV(findings) {
    var header = ['Platform', 'Program Name', 'Handle', 'Date AI Was Introduced', 'Keyword Matched', 'Where', 'Eligible For Bounty', 'Scope Identifier'];
    var rows = findings.map(function (r) {
      return [
        r.platform,
        r.program_name,
        r.handle,
        r.date_introduced,
        r.keyword_matched,
        r.where,
        String(r.eligible_for_bounty),
        r.scope_identifier,
      ].map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(',');
    });
    var csv = header.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bb_ai_scope_findings.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Public API ───────────────────────────────────────────────

  window.BBScanner = {
    scan: scan,
    exportCSV: exportCSV,
    SCANNERS: SCANNERS,
    findAIKeywords: findAIKeywords,
    hasAIDomain: hasAIDomain,
  };
})();
