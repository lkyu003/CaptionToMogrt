/* global app, File, $ */
(function () {
  "use strict";

  var TICKS_PER_SECOND = 254016000000;

  function escapeJsonString(value) {
    var source = String(value);
    var result = "";
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      var code = source.charCodeAt(i);
      if (ch === "\\") {
        result += "\\\\";
      } else if (ch === '"') {
        result += '\\"';
      } else if (ch === "\r") {
        result += "\\r";
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\t") {
        result += "\\t";
      } else if (code < 32 || code > 126) {
        result += "\\u" + ("0000" + code.toString(16)).slice(-4);
      } else {
        result += ch;
      }
    }
    return result;
  }

  function jsonString(value) {
    return '"' + escapeJsonString(value) + '"';
  }

  function okJson(fields) {
    return '{"ok":true' + (fields ? "," + fields : "") + "}";
  }

  function errorJson(error) {
    return '{"ok":false,"error":' + jsonString(error) + "}";
  }

  function errorJsonWithDiagnostics(error, diagnostics) {
    var items = [];
    var maxItems = Math.min(diagnostics.length, 40);
    for (var i = 0; i < maxItems; i++) {
      items.push(jsonString(diagnostics[i]));
    }
    if (diagnostics.length > maxItems) {
      items.push(jsonString("Diagnostics truncated: " + diagnostics.length + " total lines."));
    }
    return '{"ok":false,"error":' + jsonString(error) + ',"diagnostics":[' + items.join(",") + "]}";
  }

  function parsePayload(payloadText) {
    return JSON.parse(decodeURIComponent(payloadText));
  }

  function secondsToTicks(seconds) {
    return String(Math.round(Number(seconds) * TICKS_PER_SECOND));
  }

  function getActiveSequence() {
    if (!app.project || !app.project.activeSequence) {
      throw new Error("No active sequence.");
    }
    return app.project.activeSequence;
  }

  function getSingleSelectedClip(sequence) {
    var selection = sequence.getSelection();
    if (!selection || selection.length !== 1) {
      throw new Error("Select exactly one sample MOGRT clip in the timeline.");
    }
    return selection[0];
  }

  function findClipByNodeId(sequence, nodeId) {
    if (!nodeId) {
      return null;
    }

    for (var trackIndex = 0; trackIndex < sequence.videoTracks.numTracks; trackIndex++) {
      var clips = sequence.videoTracks[trackIndex].clips;
      for (var clipIndex = 0; clipIndex < clips.numItems; clipIndex++) {
        if (String(clips[clipIndex].nodeId) === String(nodeId)) {
          return clips[clipIndex];
        }
      }
    }
    return null;
  }

  function findClipByRef(sequence, ref) {
    var clip = findClipByNodeId(sequence, ref.nodeId);
    if (clip) {
      return clip;
    }

    var trackIndex = Number(ref.trackIndex);
    if (trackIndex >= 0 && trackIndex < sequence.videoTracks.numTracks) {
      return getClipAt(sequence.videoTracks[trackIndex], ref.startTicks);
    }

    return null;
  }

  function getMgtComponent(clip) {
    if (!clip || !clip.getMGTComponent) {
      throw new Error("The selected clip does not expose an MOGRT component.");
    }
    var component = clip.getMGTComponent();
    if (!component || !component.properties) {
      throw new Error("The selected MOGRT has no exposed parameters.");
    }
    return component;
  }

  function tryGetMgtComponent(clip, diagnostics) {
    try {
      if (!clip || !clip.getMGTComponent) {
        diagnostics.push("clip.getMGTComponent is not available.");
        return null;
      }

      var component = clip.getMGTComponent();
      if (!component) {
        diagnostics.push("clip.getMGTComponent returned null.");
        return null;
      }
      if (!component.properties) {
        diagnostics.push("MGT component exists, but it has no properties collection.");
        return null;
      }

      diagnostics.push("MGT component=" + (component.displayName || component.matchName || "unnamed") + ", properties=" + collectionCount(component.properties));
      return component;
    } catch (err) {
      diagnostics.push("getMGTComponent failed: " + (err.message || err));
      return null;
    }
  }

  function collectionCount(collection) {
    if (!collection) {
      return 0;
    }
    if (typeof collection.numItems === "number") {
      return collection.numItems;
    }
    if (typeof collection.length === "number") {
      return collection.length;
    }
    return 0;
  }

  function looksLikeTextParam(param) {
    var name = String(param.displayName || "").toLowerCase();
    return isSourceTextName(name);
  }

  function isSourceTextName(name) {
    var value = String(name || "").toLowerCase();
    return value === "source text" ||
      value === "sourcetext" ||
      value.indexOf("source text") >= 0 ||
      value.indexOf("source_text") >= 0 ||
      value.indexOf("\uc18c\uc2a4 \ud14d\uc2a4\ud2b8") >= 0 ||
      value.indexOf("\uc18c\uc2a4\ud14d\uc2a4\ud2b8") >= 0;
  }

  function getValueType(param) {
    try {
      var value = param.getValue();
      if (typeof value === "string") {
        if (value.charAt(0) === "{" && value.indexOf('"text"') >= 0) {
          return "text document json";
        }
        return "string";
      }
      return typeof value;
    } catch (err) {
      return "unreadable";
    }
  }

  function previewValue(param) {
    try {
      var value = param.getValue();
      var asString = String(value);
      if (asString.length > 180) {
        asString = asString.substring(0, 180) + "...";
      }
      return asString.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    } catch (err) {
      return "unreadable";
    }
  }

  function valueShape(value) {
    var text = String(value);
    var codes = [];
    var max = Math.min(text.length, 8);
    for (var i = 0; i < max; i++) {
      codes.push(text.charCodeAt(i));
    }
    return "length=" + text.length + ", jsonAt=" + text.indexOf("{") + ", codes=" + codes.join("/");
  }

  function stringifyValue(value) {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return null;
    }
  }

  function unquoteJsonString(value) {
    if (typeof value !== "string") {
      return value;
    }
    if (value.length >= 2 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      try {
        return JSON.parse(value);
      } catch (err) {
        return value;
      }
    }
    return value;
  }

  function previewParamValue(param) {
    return previewValue(param);
  }

  function pushTextParamsFromProperties(params, properties, prefix, componentName, diagnostics) {
    var count = collectionCount(properties);
    diagnostics.push(componentName + " properties=" + count);

    for (var i = 0; i < count; i++) {
      var param = properties[i];
      var displayName = param.displayName || "Parameter " + (i + 1);
      var valueType = getValueType(param);
      if (diagnostics.length < 40) {
        diagnostics.push("  [" + prefix + ":" + i + "] " + displayName + " / " + valueType + " / " + previewValue(param));
      }

      if (looksLikeTextParam(param)) {
        params.push(
          '{"id":' + jsonString(prefix + ":" + i) +
          ',"index":' + i +
          ',"rawName":' + jsonString(displayName) +
          ',"displayName":' + jsonString(componentName + " > " + displayName + " [" + valueType + "]") +
          ',"isTextLike":true' +
          "}"
        );
      }
    }
  }

  function paramValueText(param) {
    try {
      var value = param.getValue();
      if (value === null || typeof value === "undefined") {
        return "";
      }
      if (typeof value === "object") {
        return JSON.stringify(value);
      }
      return String(value);
    } catch (err) {
      return "";
    }
  }

  function isColorControlName(name) {
    var value = String(name || "").toLowerCase();
    return value.indexOf("color") >= 0 ||
      value.indexOf("colour") >= 0 ||
      value.indexOf("\uc0c9") >= 0 ||
      value.indexOf("\uceec\ub7ec") >= 0;
  }

  function pushControlParamsFromMgt(controls, properties, diagnostics) {
    var count = collectionCount(properties);
    for (var i = 0; i < count; i++) {
      var param = properties[i];
      var displayName = param.displayName || param.name || "Parameter " + (i + 1);
      if (looksLikeTextParam(param)) {
        continue;
      }

      var valueType = getValueType(param);
      var controlKind = isColorControlName(displayName) ? "color" : "";
      controls.push(
        '{"id":' + jsonString("mgt:" + i) +
        ',"index":' + i +
        ',"rawName":' + jsonString(displayName) +
        ',"displayName":' + jsonString(displayName + " [" + valueType + "]") +
        ',"valueType":' + jsonString(valueType) +
        ',"controlKind":' + jsonString(controlKind) +
        ',"valueText":' + jsonString(paramValueText(param)) +
        "}"
      );
    }
    diagnostics.push("MGT controls=" + controls.length);
  }

  function collectTextParams(clip, diagnostics) {
    var params = [];
    var mgtComponent = tryGetMgtComponent(clip, diagnostics);
    if (mgtComponent && mgtComponent.properties) {
      pushTextParamsFromProperties(params, mgtComponent.properties, "mgt", "MOGRT", diagnostics);
    }

    var components = clip.components;
    var componentCount = collectionCount(components);
    diagnostics.push("Clip components=" + componentCount);
    for (var c = 0; c < componentCount; c++) {
      var component = components[c];
      if (component && component.properties) {
        var componentName = component.displayName || component.matchName || "Component " + (c + 1);
        pushTextParamsFromProperties(params, component.properties, "component:" + c, componentName, diagnostics);
      }
    }

    return params;
  }

  function collectControlParams(clip, diagnostics) {
    var controls = [];
    var mgtComponent = tryGetMgtComponent(clip, diagnostics);
    if (mgtComponent && mgtComponent.properties) {
      pushControlParamsFromMgt(controls, mgtComponent.properties, diagnostics);
    }
    return controls;
  }

  function resolveParam(clip, paramId, fallbackIndex) {
    var parts = String(paramId || "").split(":");
    if (parts[0] === "component") {
      var componentIndex = Number(parts[1]);
      var propertyIndex = Number(parts[2]);
      if (clip.components && clip.components[componentIndex] && clip.components[componentIndex].properties) {
        return getSourceTextParamFromProperties(clip.components[componentIndex].properties, clip.components[componentIndex].properties[propertyIndex]);
      }
      return null;
    }

    var component = getMgtComponent(clip);
    var index = parts[0] === "mgt" ? Number(parts[1]) : Number(fallbackIndex);
    return getSourceTextParamFromProperties(component.properties, component.properties[index]);
  }

  function getSourceTextParamFromProperties(properties, fallbackParam) {
    if (!properties) {
      return fallbackParam;
    }

    var names = [];
    if (fallbackParam && fallbackParam.displayName) {
      names.push(fallbackParam.displayName);
    }
    names.push("Source Text");
    names.push("\uc18c\uc2a4 \ud14d\uc2a4\ud2b8");
    names.push("\uc18c\uc2a4\ud14d\uc2a4\ud2b8");

    if (properties.getParamForDisplayName) {
      for (var i = 0; i < names.length; i++) {
        try {
          var param = properties.getParamForDisplayName(names[i]);
          if (param) {
            return param;
          }
        } catch (err) {}
      }
    }

    return fallbackParam;
  }

  function getOfficialMgtSourceTextParam(clip, selectedName) {
    var component = null;
    try {
      component = getMgtComponent(clip);
    } catch (err) {
      return null;
    }

    if (!component || !component.properties || !component.properties.getParamForDisplayName) {
      return null;
    }

    var names = [];
    if (selectedName) {
      names.push(selectedName);
    }
    names.push("Source Text");
    names.push("\uc18c\uc2a4 \ud14d\uc2a4\ud2b8");
    names.push("\uc18c\uc2a4\ud14d\uc2a4\ud2b8");

    for (var i = 0; i < names.length; i++) {
      try {
        var param = component.properties.getParamForDisplayName(names[i]);
        if (param) {
          return param;
        }
      } catch (getErr) {}
    }

    return null;
  }

  function namesMatch(candidateName, selectedName) {
    var candidate = String(candidateName || "").toLowerCase();
    var selected = String(selectedName || "").toLowerCase();
    if (!candidate || !selected) {
      return false;
    }
    if (selected.indexOf(">") >= 0) {
      selected = selected.substring(selected.lastIndexOf(">") + 1).replace(/^\s+|\s+$/g, "");
    }
    return candidate === selected || candidate.indexOf(selected) >= 0 || selected.indexOf(candidate) >= 0;
  }

  function findParamByName(clip, selectedName) {
    var component = null;
    try {
      component = getMgtComponent(clip);
    } catch (mgtErr) {
      component = null;
    }

    if (component && component.properties) {
      for (var m = 0; m < collectionCount(component.properties); m++) {
        if (looksLikeTextParam(component.properties[m]) && namesMatch(component.properties[m].displayName, selectedName)) {
          return getSourceTextParamFromProperties(component.properties, component.properties[m]);
        }
      }
    }

    var components = clip.components;
    for (var c = 0; c < collectionCount(components); c++) {
      if (components[c] && components[c].properties) {
        for (var p = 0; p < collectionCount(components[c].properties); p++) {
          if (looksLikeTextParam(components[c].properties[p]) && namesMatch(components[c].properties[p].displayName, selectedName)) {
            return getSourceTextParamFromProperties(components[c].properties, components[c].properties[p]);
          }
        }
      }
    }

    return null;
  }

  function resolveTextParam(clip, paramId, fallbackIndex, selectedName) {
    var officialParam = getOfficialMgtSourceTextParam(clip, selectedName);
    if (officialParam) {
      return officialParam;
    }

    var param = null;
    try {
      param = resolveParam(clip, paramId, fallbackIndex);
    } catch (err) {
      param = null;
    }
    if (param && looksLikeTextParam(param)) {
      return param;
    }
    return findParamByName(clip, selectedName);
  }

  function resolveMgtParamByOverride(clip, override) {
    var component = getMgtComponent(clip);
    var properties = component.properties;

    if (override.rawName && properties.getParamForDisplayName) {
      try {
        var named = properties.getParamForDisplayName(override.rawName);
        if (named) {
          return named;
        }
      } catch (err) {}
    }

    var parts = String(override.id || "").split(":");
    if (parts[0] === "mgt") {
      return properties[Number(parts[1])];
    }

    return null;
  }

  function parseOverrideValue(override) {
    if (override.controlKind === "color") {
      return hexColorToPackedNumber(override.value);
    }

    var valueType = String(override.valueType || "");
    var value = override.value;

    if (valueType === "number") {
      return Number(value);
    }
    if (valueType === "boolean") {
      return value === true || value === "true";
    }
    if (valueType === "object") {
      try {
        return JSON.parse(String(value));
      } catch (err) {
        return value;
      }
    }
    return value;
  }

  function hexColorToPackedNumber(value) {
    var hex = String(value || "").replace("#", "");
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (hex.length !== 6) {
      throw new Error("Invalid color value: " + value);
    }

    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);

    return Math.pow(2, 56) +
      (r * Math.pow(2, 40)) +
      (g * Math.pow(2, 24)) +
      (b * Math.pow(2, 8));
  }

  function applyControlOverrides(clip, overrides, updateUI, warnings, captionNumber) {
    if (!overrides || !overrides.length) {
      return 0;
    }

    var applied = 0;
    for (var i = 0; i < overrides.length; i++) {
      var override = overrides[i];
      try {
        var param = resolveMgtParamByOverride(clip, override);
        if (!param) {
          throw new Error("Control parameter not found: " + override.rawName);
        }
        param.setValue(parseOverrideValue(override), updateUI ? 1 : 0);
        applied++;
      } catch (err) {
        warnings.push("Caption " + captionNumber + ": control apply failed for " + (override.rawName || override.id) + " - " + (err.message || err));
      }
    }
    return applied;
  }

  function getClipAt(track, startTicks) {
    var clips = track.clips;
    var best = null;
    var bestDistance = Number.MAX_VALUE;
    for (var i = 0; i < collectionCount(clips); i++) {
      var clip = clips[i];
      var distance = Math.abs(Number(clip.start.ticks) - Number(startTicks));
      if (distance < bestDistance) {
        best = clip;
        bestDistance = distance;
      }
    }
    return best;
  }

  function getProjectItemPath(projectItem) {
    if (!projectItem || !projectItem.getMediaPath) {
      return "";
    }

    try {
      return projectItem.getMediaPath() || "";
    } catch (err) {
      return "";
    }
  }

  function insertSample(sequence, track, sampleProjectItem, mogrtPath, startTicks, targetVideoTrack, targetAudioTrack, overwrite) {
    if (mogrtPath && sequence.importMGT) {
      return sequence.importMGT(mogrtPath, startTicks, targetVideoTrack, targetAudioTrack);
    }

    var mediaPath = getProjectItemPath(sampleProjectItem);
    if (mediaPath && mediaPath.toLowerCase().lastIndexOf(".mogrt") === mediaPath.length - 6 && sequence.importMGT) {
      return sequence.importMGT(mediaPath, startTicks, targetVideoTrack, targetAudioTrack);
    }

    if (!sampleProjectItem) {
      throw new Error("No MOGRT path or ProjectItem is available for insertion.");
    }

    if (overwrite) {
      track.overwriteClip(sampleProjectItem, startTicks);
    } else {
      track.insertClip(sampleProjectItem, startTicks, targetVideoTrack, targetAudioTrack);
    }

    return getClipAt(track, startTicks);
  }

  function replaceTextFields(value, text) {
    var changed = false;

    function isTextBodyKey(keyName) {
      var key = String(keyName || "").toLowerCase();
      return key === "mtextparam" ||
        key === "text" ||
        key === "texteditvalue" ||
        key === "sourcetext";
    }

    function visit(node, keyName) {
      if (typeof node === "string") {
        if (isTextBodyKey(keyName)) {
          changed = true;
          return text;
        }
        return node;
      }

      if (!node || typeof node !== "object") {
        return node;
      }

      if (node instanceof Array) {
        for (var i = 0; i < node.length; i++) {
          node[i] = visit(node[i], "");
        }
        return node;
      }

      for (var prop in node) {
        if (node.hasOwnProperty(prop)) {
          node[prop] = visit(node[prop], prop);
        }
      }
      return node;
    }

    var result = visit(value, "");
    return { value: result, changed: changed };
  }

  function replacePremiereSourceTextJson(rawValue, text) {
    var raw = String(rawValue);

    if (raw.length > 4) {
      try {
        var linkPrefix = raw.substring(0, 4);
        var linkParsed = JSON.parse(raw.substring(4));
        if (linkParsed.mTextParam && linkParsed.mTextParam.mStyleSheet) {
          linkParsed.mTextParam.mStyleSheet.mText = text;
          return linkPrefix + JSON.stringify(linkParsed);
        }
      } catch (linkErr) {}
    }

    var jsonStart = raw.indexOf("{");
    if (jsonStart < 0) {
      return null;
    }
    var prefix = raw.substring(0, jsonStart);
    var parsed = JSON.parse(raw.substring(jsonStart));

    if (parsed.mTextParam && parsed.mTextParam.mStyleSheet) {
      parsed.mTextParam.mStyleSheet.mText = text;
      return prefix + JSON.stringify(parsed);
    }

    var replaced = replaceTextFields(parsed, text);
    if (replaced.changed) {
      return prefix + JSON.stringify(replaced.value);
    }

    return null;
  }

  function getSourceTextValueCandidates(param, clip) {
    var candidates = [];
    var value = null;

    try {
      value = param.getValue();
      candidates.push({ label: "getValue", value: value });
      var jsonValue = stringifyValue(value);
      if (jsonValue !== null) {
        candidates.push({ label: "JSON.stringify(getValue)", value: unquoteJsonString(jsonValue) });
      }
    } catch (err) {}

    if (param.getValueAtTime && clip && clip.start) {
      try {
        value = param.getValueAtTime(clip.start);
        candidates.push({ label: "getValueAtTime(start)", value: value });
        var jsonTimeValue = stringifyValue(value);
        if (jsonTimeValue !== null) {
          candidates.push({ label: "JSON.stringify(getValueAtTime)", value: unquoteJsonString(jsonTimeValue) });
        }
      } catch (timeErr) {}
    }

    return candidates;
  }

  function setParamText(param, text, updateUI, clip) {
    var currentValue = null;
    try {
      currentValue = param.getValue();
    } catch (err) {
      currentValue = null;
    }

    if (looksLikeTextParam(param)) {
      var candidates = getSourceTextValueCandidates(param, clip);
      for (var c = 0; c < candidates.length; c++) {
        try {
          var candidateOut = replacePremiereSourceTextJson(candidates[c].value, text);
          if (candidateOut !== null) {
            return param.setValue(candidateOut, updateUI ? 1 : 0);
          }
        } catch (candidateErr) {}
      }
    }

    if (typeof currentValue === "string") {
      try {
        var sourceTextJson = replacePremiereSourceTextJson(currentValue, text);
        if (sourceTextJson !== null) {
          return param.setValue(sourceTextJson, updateUI ? 1 : 0);
        }
      } catch (jsonErr) {
        // Fall through to plain string for AE-authored MOGRT text controls.
      }

      if (looksLikeTextParam(param) && currentValue.indexOf("{") < 0) {
        throw new Error("Source Text did not expose its JSON payload. This matches Premiere NewWorld behavior; refusing to overwrite it with a plain string.");
      }
    }

    if (currentValue && typeof currentValue === "object") {
      try {
        var replacedObject = replaceTextFields(currentValue, text);
        if (replacedObject.changed) {
          return param.setValue(replacedObject.value, updateUI ? 1 : 0);
        }
        return param.setValue(text, updateUI ? 1 : 0);
      } catch (objectErr) {
        try {
          return param.setValue(JSON.stringify(currentValue), updateUI ? 1 : 0);
        } catch (stringifyErr) {}
      }
    }

    return param.setValue(text, updateUI ? 1 : 0);
  }

  function clipRefJson(clip, trackIndex, startTicks, text) {
    return "{" +
      '"nodeId":' + jsonString(clip && clip.nodeId ? clip.nodeId : "") + "," +
      '"trackIndex":' + Number(trackIndex) + "," +
      '"startTicks":' + jsonString(startTicks) + "," +
      '"text":' + jsonString(text) +
      "}";
  }

  function pushDumpLine(lines, line) {
    if (lines.length < 160) {
      lines.push(line);
    }
  }

  function dumpProperties(lines, properties, prefix, componentName) {
    pushDumpLine(lines, componentName + " properties=" + collectionCount(properties));
    for (var i = 0; i < collectionCount(properties); i++) {
      var param = properties[i];
      var name = param && param.displayName ? param.displayName : "Parameter " + (i + 1);
      pushDumpLine(lines, "[" + prefix + ":" + i + "] " + name + " / " + getValueType(param) + " / " + previewValue(param));
    }
  }

  function dumpSourceTextCandidates(lines, clip, param, label) {
    var candidates = getSourceTextValueCandidates(param, clip);
    for (var i = 0; i < candidates.length; i++) {
      pushDumpLine(lines, label + " " + candidates[i].label + " shape: " + valueShape(candidates[i].value));
      pushDumpLine(lines, label + " " + candidates[i].label + " preview: " + String(candidates[i].value).substring(0, 220).replace(/\r/g, "\\r").replace(/\n/g, "\\n"));
    }
  }

  function dumpClipParams(clip) {
    var lines = [];
    pushDumpLine(lines, "Clip name=" + (clip.name || ""));
    pushDumpLine(lines, "Clip nodeId=" + (clip.nodeId || ""));

    var mgtComponent = tryGetMgtComponent(clip, lines);
    if (mgtComponent && mgtComponent.properties) {
        dumpProperties(lines, mgtComponent.properties, "mgt", "MOGRT");
        for (var m = 0; m < collectionCount(mgtComponent.properties); m++) {
          if (looksLikeTextParam(mgtComponent.properties[m])) {
            dumpSourceTextCandidates(lines, clip, mgtComponent.properties[m], "[mgt:" + m + "]");
          }
        }
      }

    var components = clip.components;
    pushDumpLine(lines, "Clip components=" + collectionCount(components));
    for (var c = 0; c < collectionCount(components); c++) {
      var component = components[c];
      if (component && component.properties) {
        dumpProperties(lines, component.properties, "component:" + c, component.displayName || component.matchName || "Component " + (c + 1));
        for (var p = 0; p < collectionCount(component.properties); p++) {
          if (looksLikeTextParam(component.properties[p])) {
            dumpSourceTextCandidates(lines, clip, component.properties[p], "[component:" + c + ":" + p + "]");
          }
        }
      }
    }

    if (lines.length >= 160) {
      lines.push("Dump truncated.");
    }
    return lines;
  }

  function dumpChosenParamCandidates(lines, clip, param) {
    pushDumpLine(lines, "Chosen param name=" + (param.displayName || "unnamed"));
    pushDumpLine(lines, "Chosen param preview=" + previewValue(param));
    pushDumpLine(lines, "Chosen param shape=" + valueShape(param.getValue()));
    dumpSourceTextCandidates(lines, clip, param, "[chosen]");
  }

  function linesJson(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      out.push(jsonString(lines[i]));
    }
    return "[" + out.join(",") + "]";
  }

  $.srtMogrt = {
    chooseSrtFile: function () {
      try {
        var file = File.openDialog("Select SRT file", "*.srt", false);
        if (!file) {
          return errorJson("SRT file selection was cancelled.");
        }
        file.encoding = "UTF-8";
        if (!file.open("r")) {
          return errorJson("Could not open the SRT file.");
        }
        var content = file.read();
        file.close();
        return okJson('"path":' + jsonString(file.fsName) + ',"content":' + jsonString(content));
      } catch (err) {
        return errorJson(err.message || err);
      }
    },

    chooseMogrtFile: function () {
      try {
        var file = File.openDialog("Select MOGRT file", "*.mogrt", false);
        if (!file) {
          return errorJson("MOGRT file selection was cancelled.");
        }
        return okJson('"path":' + jsonString(file.fsName));
      } catch (err) {
        return errorJson(err.message || err);
      }
    },

    inspectSelectedMogrt: function () {
      try {
        var sequence = getActiveSequence();
        var clip = getSingleSelectedClip(sequence);
        var diagnostics = [
          "Clip name=" + (clip.name || ""),
          "Clip type=" + clip.type + ", mediaType=" + clip.mediaType,
          "Project item=" + (clip.projectItem ? clip.projectItem.name : "none")
        ];
        var params = collectTextParams(clip, diagnostics);
        var controls = collectControlParams(clip, diagnostics);

        if (!params.length) {
          return errorJsonWithDiagnostics("No editable text parameter was found on the selected clip.", diagnostics);
        }

        return okJson('"sampleNodeId":' + jsonString(clip.nodeId || "") + ',"params":[' + params.join(",") + '],"controls":[' + controls.join(",") + "]");
      } catch (err) {
        return errorJson(err.message || err);
      }
    },

    insertCaptionClips: function (payloadJson) {
      try {
        var payload = parsePayload(payloadJson);
        var sequence = getActiveSequence();
        var sampleClip = findClipByNodeId(sequence, payload.sampleNodeId) || getSingleSelectedClip(sequence);
        var sampleProjectItem = sampleClip.projectItem;
        var warnings = [];
        var items = [];
        var startIndex = Number(payload.startIndex) || 0;
        var targetVideoTrack = Number(payload.targetVideoTrack);
        var targetAudioTrack = Number(payload.targetAudioTrack);

        if (!payload.mogrtPath && !sampleProjectItem) {
          throw new Error("Choose a source .mogrt file. The selected clip has no ProjectItem to clone.");
        }
        if (targetVideoTrack < 0 || targetVideoTrack >= sequence.videoTracks.numTracks) {
          throw new Error("Target video track is out of range.");
        }

        var track = sequence.videoTracks[targetVideoTrack];
        var created = 0;

        for (var i = 0; i < payload.captions.length; i++) {
          var caption = payload.captions[i];
          var startTicks = secondsToTicks(caption.start);
          var endTicks = secondsToTicks(caption.end);

          var newClip = insertSample(sequence, track, sampleProjectItem, payload.mogrtPath, startTicks, targetVideoTrack, targetAudioTrack, payload.overwrite);
          if (!newClip) {
            warnings.push("Caption " + (startIndex + i + 1) + ": inserted clip was not found.");
            continue;
          }

          try {
            newClip.start = startTicks;
            newClip.end = endTicks;
            newClip.outPoint = String(Number(newClip.inPoint.ticks) + Number(endTicks) - Number(startTicks));
          } catch (trimErr) {
            warnings.push("Caption " + (startIndex + i + 1) + ": trim failed - " + trimErr.message);
          }

          items.push(clipRefJson(newClip, targetVideoTrack, startTicks, caption.text));
          created++;
        }

        try {
          $.gc();
        } catch (gcErr) {}

        var warningJson = [];
        for (var w = 0; w < warnings.length; w++) {
          warningJson.push(jsonString(warnings[w]));
        }
        return okJson('"created":' + created + ',"items":[' + items.join(",") + '],"warnings":[' + warningJson.join(",") + "]");
      } catch (err) {
        return errorJson(err.message || err);
      }
    },

    applyCaptionTexts: function (payloadJson) {
      try {
        var payload = parsePayload(payloadJson);
        var sequence = getActiveSequence();
        var warnings = [];
        var applied = 0;
        var startIndex = Number(payload.startIndex) || 0;

        for (var i = 0; i < payload.items.length; i++) {
          var item = payload.items[i];
          var clip = findClipByRef(sequence, item);
          if (!clip) {
            warnings.push("Caption " + (startIndex + i + 1) + ": clip was not found for text apply.");
            continue;
          }

          try {
            var param = resolveTextParam(clip, payload.textParamId, payload.textParamIndex, payload.textParamName);
            if (!param) {
              throw new Error("Selected text parameter was not found.");
            }
            var setResult = setParamText(param, item.text, i === payload.items.length - 1, clip);
            if (setResult === false) {
              warnings.push("Caption " + (startIndex + i + 1) + ": setValue returned " + setResult);
            }
            if (payload.fixedTextParamId && payload.fixedText) {
              var fixedParam = resolveTextParam(clip, payload.fixedTextParamId, payload.fixedTextParamIndex, payload.fixedTextParamName);
              if (!fixedParam) {
                throw new Error("Selected fixed text parameter was not found.");
              }
              setParamText(fixedParam, payload.fixedText, i === payload.items.length - 1, clip);
            }
            applyControlOverrides(clip, payload.controlOverrides, i === payload.items.length - 1, warnings, startIndex + i + 1);
            applied++;
          } catch (textErr) {
            warnings.push("Caption " + (startIndex + i + 1) + ": text apply failed - " + textErr.message);
          }
        }

        try {
          $.gc();
        } catch (gcErr) {}

        var warningJson = [];
        for (var w = 0; w < warnings.length; w++) {
          warningJson.push(jsonString(warnings[w]));
        }
        return okJson('"applied":' + applied + ',"warnings":[' + warningJson.join(",") + "]");
      } catch (err) {
        return errorJson(err.message || err);
      }
    }
  };
})();
