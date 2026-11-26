(() => {
"use strict";
const $ = id => document.getElementById(id);
let token = null;
let pairingPollActive = false;
let pairingCompletionId = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if *.¶›­¶»§q«^