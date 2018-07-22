"use strict";

const {ipcRenderer} = require("electron");
const {BrowserWindow, app} = require("electron").remote;
const settings = require("electron-settings");
const http = require("http");
const https = require("https");
const fs = require("fs-extra");
const ua = require("universal-analytics");
const validator = require("validator");

const firebase = require("firebase");
require("firebase/firestore");

// Initialize Firebase
var config = {
  apiKey: "AIzaSyBETZTOgv7hlOL1sHlskFftbmjF0eJl4zo",
  authDomain: "mastercomfig-a9225.firebaseapp.com",
  databaseURL: "https://mastercomfig-a9225.firebaseio.com",
  projectId: "mastercomfig-a9225",
  storageBucket: "mastercomfig-a9225.appspot.com",
  messagingSenderId: "765315683049"
};
firebase.initializeApp(config);

function uuid(a) {
  return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) :
    ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, uuid);
}

let visitor;

if (settings.get("tracking.consent", 1)) {
  let trackingUuid = settings.get("tracking.uuid", uuid());
  if (!validator.isUUID(trackingUuid, 4)) {
    trackingUuid = trackingUuid();
    settings.set("tracking.uuid", trackingUuid);
  }
  visitor = ua("UA-122662888-1", trackingUuid);
  visitor.set("ds", "app");
  visitor.set("an", app.getName());
  visitor.set("av", app.getVersion());
}

const db = firebase.firestore();
db.settings({timestampsInSnapshots: true});

Number.prototype.roundD = function(decimals, rounder) {
  if (!rounder) {
    rounder = Math.round;
  }
  return Number(rounder(this + "e" + decimals) + "e-" + decimals);
};

Number.prototype.ceilD = function(decimals) {
  return this.roundD(decimals, Math.ceil);
};

Number.prototype.floorD = function(decimals) {
  return this.roundD(decimals, Math.ceil);
};

Number.prototype.clamp = function(min, max) {
  return Math.min(Math.max(this, min), max);
};

String.prototype.toProperCase = function() {
  return this.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
};

String.prototype.escapeRegExp = function() {
  return this.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
};

String.prototype.replaceAll = function(substr, replacement) {
  return this.replace(new RegExp(substr.escapeRegExp(), "g"), replacement);
};

String.prototype.format = function() {
  let args = arguments;
  return this.replace(/{(\d+)}/g, (match, number) => {
    return typeof args[number] !== "undefined" ? args[number] : match;
  });
};

function getResponse(url, file) {
  return new Promise((resolve, reject) => {
    const requester = url.startsWith("https:") ? https : http;
    var request = requester.get(url, response => {
      if (response.statusCode === 200) {
        resolve(response);
      } else if ([301, 302].indexOf(response.statusCode) !== -1 &&
        response.headers.location) {
        requester.get(response.headers.location, response => resolve(response));
      } else {
        reject(
          `Server responded with ${response.statusCode}: ${response.statusMessage}`);
      }
    });

    if (file) {
      request.on("error", err => {
        file.close();
        fs.unlink(file.path, () => {
        });
        reject(err.message);
      });
    }
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    getResponse(url, file)
      .then((response) => {
        response.pipe(file);

        file.on("finish", () => {
          resolve();
        });

        file.on("error", err => {
          file.close();
          fs.unlink(dest, () => {
          });
          reject(err.message);
        });
      })
      .catch((error) => {
        reject(error);
      });
  });
}

function downloadVpk(vpk, version) {
  let rootVpkDl = settings.get("custom-vpk-download");
  let isCustomVpkDl = true;
  if (!rootVpkDl) {
    rootVpkDl =
      "https://github.com/mastercoms/mastercomfig/releases/download/" +
      version + "/";
    isCustomVpkDl = false;
  }
  let destPath = settings.get("tf2-folder") + "/tf/custom/" +
    vpk;
  if (!isCustomVpkDl) {
    let cachePath = app.getPath("userData") + "/Comfig/VPK/" + version + "/" +
      vpk;
    if (fs.existsSync(cachePath)) {
      return fs.copy(cachePath, destPath);
    } else {
      return fs.ensureDir(app.getPath("userData") + "/Comfig/VPK/" + version + "/")
        .then(() => {
          console.log("hi");
          return download(rootVpkDl + vpk, cachePath);
        }).then(() => {
          console.log("hif");
          return fs.copy(cachePath, destPath);
        });
    }
  }
  return download(rootVpkDl + vpk, destPath);
}

function handleException(error) {
  console.error(error);
  if (visitor) {
    visitor.exception(error).send();
  }
  let notif = document.getElementById("error-notification");
  if (notif) {
    notif.innerText = error;
    notif.opened = true;
  }
}

let sha = settings.get("config-sha");

function setTargetSha(newSha) {
  settings.set("config-sha", newSha);
  sha = newSha;
}

function setToProfile(path, value) {
  let currProfile = settings.get("profile", "default");
  settings.set("profiles." + currProfile + "." + path, value);
}

function getFromProfile(path, def) {
  let currProfile = settings.get("profile", "default");
  if (def) {
    return settings.get("profiles." + currProfile + "." + path, def);
  }
  return settings.get("profiles." + currProfile + "." + path);
}

function fetchConfigData(path) {
  if (sha) {
    let cachePath = app.getPath("userData") + "/Comfig/" + sha + "/" + path;
    if (fs.existsSync(cachePath)) {
      return Promise.resolve(fs.readJson(cachePath));
    }
    return fetch(settings.get(
      "config-data-url",
      "https://raw.githubusercontent.com/mastercoms/mastercomfig/") +
      sha + "/" + path).then(response => {
      return response.json();
    }).then(json => {
      fs.outputJson(cachePath, json);
      return Promise.resolve(json);
    });
  }
  return fetch(settings.get(
    "config-data-url",
    "https://raw.githubusercontent.com/mastercoms/mastercomfig/") + path).then(
    response => {
      return response.json();
    }
  );
}