(function () {
  "use strict";

  var cs = new CSInterface();
  var state = {
    srtPath: "",
    mogrtPath: "",
    captions: [],
    textParams: [],
    controlParams: [],
    sampleNodeId: ""
  };

  var els = {
    hostStatus: document.getElementById("hostStatus"),
    chooseSrtButton: document.getElementById("chooseSrtButton"),
    chooseMogrtButton: document.getElementById("chooseMogrtButton"),
    scanMogrtButton: document.getElementById("scanMogrtButton"),
    applyButton: document.getElementById("applyButton"),
    srtSummary: document.getElementById("srtSummary"),
    mogrtSummary: document.getElementById("mogrtSummary"),
    textParamSelect: document.getElementById("textParamSelect"),
    fixedTextParamSelect: document.getElementById("fixedTextParamSelect"),
    fixedTextInput: document.getElementById("fixedTextInput"),
    fontOverrideCheckbox: document.getElementById("fontOverrideCheckbox"),
    fontFamilyInput: document.getElementById("fontFamilyInput"),
    loadFontsButton: document.getElementById("loadFontsButton"),
    fontFamilySelect: document.getElementById("fontFamilySelect"),
    controlsList: document.getElementById("controlsList"),
    targetTrackInput: document.getElementById("targetTrackInput"),
    audioTrackInput: document.getElementById("audioTrackInput"),
    batchSizeInput: document.getElementById("batchSizeInput"),
    overwriteCheckbox: document.getElementById("overwriteCheckbox"),
    clearLogButton: document.getElementById("clearLogButton"),
    progress: document.getElementById("progress"),
    log: document.getElementById("log")
  };

  function log(message) {
    els.log.textContent += message + "\n";
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setBusy(isBusy) {
    els.chooseSrtButton.disabled = isBusy;
    els.chooseMogrtButton.disabled = isBusy;
    els.scanMogrtButton.disabled = isBusy;
    els.loadFontsButton.disabled = isBusy;
    els.applyButton.disabled = isBusy;
  }

  function evalHost(functionCall, callback) {
    cs.evalScript(functionCall, function (raw) {
      var result;
      try {
        result = JSON.parse(raw || "{}");
      } catch (err) {
        result = {
          ok: false,
          error: raw ? "Could not parse host response. Raw length: " + raw.length : "Host returned an empty response."
        };
      }
      callback(result);
    });
  }

  function toHostString(value) {
    return JSON.stringify(String(value));
  }

  function toHostEncodedJson(value) {
    return toHostString(encodeURIComponent(JSON.stringify(value)));
  }

  function processCaptionBatch(basePayload, startIndex, batchSize) {
    var endIndex = Math.min(startIndex + batchSize, state.captions.length);
    var payload = {};
    var key;
    for (key in basePayload) {
      if (Object.prototype.hasOwnProperty.call(basePayload, key)) {
        payload[key] = basePayload[key];
      }
    }
    payload.captions = state.captions.slice(startIndex, endIndex);
    payload.startIndex = startIndex;

    evalHost("$.srtMogrt.insertCaptionClips(" + toHostEncodedJson(payload) + ")", function (result) {
      if (!result.ok) {
        setBusy(false);
        els.progress.value = 0;
        log("Error: " + result.error);
        updateReadyState();
        return;
      }

      if (result.warnings && result.warnings.length) {
        log("Warnings:\n" + result.warnings.join("\n"));
      }

      log("Batch " + (startIndex + 1) + "-" + endIndex + " inserted, waiting for MOGRT init...");

      var textPayload = {};
      var textKey;
      for (textKey in basePayload) {
        if (Object.prototype.hasOwnProperty.call(basePayload, textKey)) {
          textPayload[textKey] = basePayload[textKey];
        }
      }
      textPayload.items = result.items || [];
      textPayload.startIndex = startIndex;

      window.setTimeout(function () {
        evalHost("$.srtMogrt.applyCaptionTexts(" + toHostEncodedJson(textPayload) + ")", function (textResult) {
          if (!textResult.ok) {
            setBusy(false);
            els.progress.value = 0;
            log("Error: " + textResult.error);
            updateReadyState();
            return;
          }

          if (textResult.warnings && textResult.warnings.length) {
            log("Warnings:\n" + textResult.warnings.join("\n"));
          }

          els.progress.value = Math.round((endIndex / state.captions.length) * 100);
          log("Batch " + (startIndex + 1) + "-" + endIndex + " done, created " + result.created + ", text applied " + textResult.applied);

          if (endIndex < state.captions.length) {
            window.setTimeout(function () {
              processCaptionBatch(basePayload, endIndex, batchSize);
            }, 250);
            return;
          }

          setBusy(false);
          log("Done: processed " + state.captions.length + " captions");
          updateReadyState();
        });
      }, 800);
    });
  }

  function parseTimecode(value) {
    var match = value.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) {
      throw new Error("Invalid SRT time: " + value);
    }
    return (
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3]) +
      Number(match[4]) / 1000
    );
  }

  function parseSrt(content) {
    var normalized = content.replace(/\r/g, "").replace(/^\uFEFF/, "");
    var blocks = normalized.split(/\n{2,}/);
    var captions = [];

    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (line) {
        return line.trim().length > 0;
      });
      if (lines.length < 2) {
        return;
      }

      var timeLineIndex = lines[0].indexOf("-->") >= 0 ? 0 : 1;
      var timeLine = lines[timeLineIndex];
      if (!timeLine || timeLine.indexOf("-->") < 0) {
        return;
      }

      var parts = timeLine.split("-->");
      var text = lines.slice(timeLineIndex + 1).join("\r");
      captions.push({
        start: parseTimecode(parts[0].trim()),
        end: parseTimecode(parts[1].trim()),
        text: text
      });
    });

    return captions.filter(function (caption) {
      return caption.end > caption.start && caption.text.length > 0;
    });
  }

  function renderTextParams() {
    els.textParamSelect.innerHTML = "";
    els.fixedTextParamSelect.innerHTML = "";
    if (!state.textParams.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No parameters found";
      els.textParamSelect.appendChild(emptyOption);
      els.fixedTextParamSelect.appendChild(emptyOption.cloneNode(true));
      return;
    }

    var noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None";
    els.fixedTextParamSelect.appendChild(noneOption);

    state.textParams.forEach(function (param, index) {
      var option = document.createElement("option");
      option.value = String(param.id || param.index);
      option.textContent = (index + 1) + ". " + (param.isTextLike ? "* " : "") + param.displayName;
      els.textParamSelect.appendChild(option);
      els.fixedTextParamSelect.appendChild(option.cloneNode(true));
    });
  }

  function renderControlParams() {
    els.controlsList.innerHTML = "";
    if (!state.controlParams.length) {
      var empty = document.createElement("div");
      empty.className = "summary";
      empty.textContent = "No exposed controls found";
      els.controlsList.appendChild(empty);
      return;
    }

    state.controlParams.forEach(function (param, index) {
      var row = document.createElement("label");
      row.className = "control-row";
      row.dataset.paramId = String(param.id);
      row.dataset.rawName = String(param.rawName || "");
      row.dataset.valueType = String(param.valueType || "string");
      row.dataset.controlKind = String(param.controlKind || "");

      var enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.className = "control-enabled";

      var name = document.createElement("div");
      name.className = "control-name";
      name.textContent = (index + 1) + ". " + param.displayName;

      var input = document.createElement("input");
      input.className = "control-input";
      input.dataset.defaultValue = param.valueText || "";

      if (param.controlKind === "color") {
        input.type = "color";
        input.value = packedColorToHex(param.valueText) || "#ffffff";
      } else if (param.valueType === "boolean") {
        input.type = "checkbox";
        input.checked = param.valueText === "true";
      } else if (param.valueType === "number") {
        input.type = "number";
        input.step = "any";
        input.value = param.valueText || "0";
      } else {
        input.type = "text";
        input.value = param.valueText || "";
      }

      row.appendChild(enabled);
      row.appendChild(name);
      row.appendChild(input);
      els.controlsList.appendChild(row);
    });
  }

  function collectControlOverrides() {
    var rows = els.controlsList.querySelectorAll(".control-row");
    var overrides = [];
    Array.prototype.forEach.call(rows, function (row) {
      var enabled = row.querySelector(".control-enabled");
      var input = row.querySelector(".control-input");
      if (!enabled || !enabled.checked || !input) {
        return;
      }

      overrides.push({
        id: row.dataset.paramId,
        rawName: row.dataset.rawName,
        valueType: row.dataset.valueType,
        controlKind: row.dataset.controlKind,
        value: input.type === "checkbox" ? input.checked : input.value
      });
    });
    return overrides;
  }

  function packedColorToHex(valueText) {
    try {
      var packed = BigInt(String(valueText));
      var r = Number((packed >> 40n) & 0xffn);
      var g = Number((packed >> 24n) & 0xffn);
      var b = Number((packed >> 8n) & 0xffn);
      return "#" + [r, g, b].map(function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    } catch (err) {
      return "";
    }
  }

  function renderFonts(fonts) {
    els.fontFamilySelect.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose a font";
    els.fontFamilySelect.appendChild(empty);

    fonts.forEach(function (font) {
      var label = typeof font === "string" ? font : font.label;
      var postScript = typeof font === "string" ? font : font.postScript;
      var option = document.createElement("option");
      option.value = postScript || label;
      option.textContent = label === postScript ? label : label + " (" + postScript + ")";
      els.fontFamilySelect.appendChild(option);
    });
  }

  function updateReadyState() {
    els.applyButton.disabled = !state.captions.length || !state.textParams.length || !state.mogrtPath;
  }

  function getSelectedTextParam() {
    return getParamBySelectValue(els.textParamSelect.value);
  }

  function getParamBySelectValue(selectedId) {
    for (var i = 0; i < state.textParams.length; i++) {
      if (String(state.textParams[i].id || state.textParams[i].index) === selectedId) {
        return state.textParams[i];
      }
    }
    return null;
  }

  els.chooseSrtButton.addEventListener("click", function () {
    setBusy(true);
    els.progress.value = 0;
    log("Choosing SRT file...");
    evalHost("$.srtMogrt.chooseSrtFile()", function (result) {
      setBusy(false);
      if (!result.ok) {
        log("Error: " + result.error);
        if (result.diagnostics && result.diagnostics.length) {
          log("Diagnostics:\n" + result.diagnostics.join("\n"));
        }
        updateReadyState();
        return;
      }

      try {
        state.srtPath = result.path;
        state.captions = parseSrt(result.content);
        els.srtSummary.textContent = result.path + " / " + state.captions.length + " captions";
        log("Parsed SRT: " + state.captions.length + " captions");
      } catch (err) {
        state.captions = [];
        log("SRT parse error: " + err.message);
      }
      updateReadyState();
    });
  });

  els.scanMogrtButton.addEventListener("click", function () {
    setBusy(true);
    log("Inspecting selected MOGRT clip...");
    evalHost("$.srtMogrt.inspectSelectedMogrt()", function (result) {
      setBusy(false);
      if (!result.ok) {
        log("Error: " + result.error);
        if (result.diagnostics && result.diagnostics.length) {
          log("Diagnostics:\n" + result.diagnostics.join("\n"));
        }
        updateReadyState();
        return;
      }

      state.sampleNodeId = result.sampleNodeId;
      state.textParams = result.params || [];
      state.controlParams = result.controls || [];
      renderTextParams();
      renderControlParams();
      log("Found " + state.textParams.length + " text parameter candidates");
      log("Found " + state.controlParams.length + " exposed controls");
      if (result.diagnostics && result.diagnostics.length) {
        log("Diagnostics:\n" + result.diagnostics.join("\n"));
      }
      updateReadyState();
    });
  });

  els.chooseMogrtButton.addEventListener("click", function () {
    setBusy(true);
    log("Choosing MOGRT file...");
    evalHost("$.srtMogrt.chooseMogrtFile()", function (result) {
      setBusy(false);
      if (!result.ok) {
        log("Error: " + result.error);
        updateReadyState();
        return;
      }

      state.mogrtPath = result.path;
      els.mogrtSummary.textContent = result.path;
      log("Selected MOGRT: " + result.path);
      updateReadyState();
    });
  });

  els.loadFontsButton.addEventListener("click", function () {
    setBusy(true);
    log("Loading installed fonts...");
    evalHost("$.srtMogrt.listInstalledFonts()", function (result) {
      setBusy(false);
      if (!result.ok) {
        log("Error: " + result.error);
        updateReadyState();
        return;
      }
      renderFonts(result.fonts || []);
      log("Loaded " + (result.fonts || []).length + " fonts");
      updateReadyState();
    });
  });

  els.fontFamilySelect.addEventListener("change", function () {
    if (els.fontFamilySelect.value) {
      els.fontFamilyInput.value = els.fontFamilySelect.value;
      els.fontOverrideCheckbox.checked = true;
    }
  });

  els.applyButton.addEventListener("click", function () {
    if (!state.captions.length) {
      log("Choose an SRT file first.");
      return;
    }
    if (!state.textParams.length) {
      log("Inspect a sample MOGRT clip first.");
      return;
    }
    if (!state.mogrtPath) {
      log("Choose the source MOGRT file first.");
      return;
    }
    if (els.fixedTextParamSelect.value && els.fixedTextParamSelect.value === els.textParamSelect.value) {
      log("Choose a different parameter for fixed text. It cannot be the same as the SRT text parameter.");
      return;
    }

    var selectedParam = getSelectedTextParam();
    var fixedParam = getParamBySelectValue(els.fixedTextParamSelect.value);
    var payload = {
      mogrtPath: state.mogrtPath,
      sampleNodeId: state.sampleNodeId,
      textParamId: els.textParamSelect.value,
      textParamName: selectedParam ? (selectedParam.rawName || selectedParam.displayName) : "",
      textParamIndex: Number(els.textParamSelect.value),
      fixedTextParamId: els.fixedTextParamSelect.value,
      fixedTextParamName: fixedParam ? (fixedParam.rawName || fixedParam.displayName) : "",
      fixedTextParamIndex: Number(els.fixedTextParamSelect.value),
      fixedText: els.fixedTextInput.value,
      textStyleOverride: {
        fontFamily: els.fontOverrideCheckbox.checked ? els.fontFamilyInput.value : ""
      },
      targetVideoTrack: Math.max(0, Number(els.targetTrackInput.value) - 1),
      targetAudioTrack: Number(els.audioTrackInput.value),
      overwrite: els.overwriteCheckbox.checked,
      controlOverrides: collectControlOverrides()
    };
    var batchSize = Math.max(1, Math.min(100, Number(els.batchSizeInput.value) || 15));

    setBusy(true);
    els.progress.value = 0;
    log("Creating MOGRT clips in batches of " + batchSize + "...");
    processCaptionBatch(payload, 0, batchSize);
  });

  els.clearLogButton.addEventListener("click", function () {
    els.log.textContent = "";
  });

  els.hostStatus.textContent = window.__adobe_cep__ ? "Premiere connected" : "Preview outside CEP";
  updateReadyState();
})();
