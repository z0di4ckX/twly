#!/usr/bin/env node
'use strict';

require('console.table');
var crypto = require('crypto');
var fs = require('fs');
var chalk = require('chalk');
var glob = require('glob');
var path = require('path');

var Message = require('./message');
var state = require('./state');
var config = require('./config');
var towelie = require('./assets/towelie');

init();

function init () {
  console.log(chalk.green(towelie));
  let glob = process.argv[2];
  if(!glob) { glob = '**/*.*'; }
  // The procedure is to (1) read (2) compare the contents and (3) report towlie's findings
  configure()
    .then(function (config) { return read(glob.toString(), config); })
    .then(function (docs){ return compare(docs); })
    .then(function (messages){ return report(messages); })
    .catch(function (err) { throw err; });
}

function configure () {
  return new Promise(function (resolve, reject) {
    fs.readFile(process.cwd() + '/.trc', 'utf-8', function (err, data) {
      let o = {
        ignore: []
      };
      if (err) {
        o.ignore = config.ignore;
      } else {
        let userConf = JSON.parse(data);
        if (userConf.ignore) {
          let ignore = userConf.ignore;
          ignore.forEach(function (p) { o.ignore.push(path.join(process.cwd(), p)); });
        }
        if (userConf.failureThreshold) { config.failureThreshold = userConf.failureThreshold; }
        if (userConf.minLines) { config.minLines = userConf.minLines; }
        if (userConf.minChars) { config.minChars = userConf.minChars; }
      }
      resolve(o);
    });
  });
}

function read (pathsToRead, config) {
  // Reading in all documents and only beginning the comparison once all have been read into memory
  return new Promise(function (resolve, reject) {
    var docs = [];
    glob(path.join(process.cwd(), pathsToRead), config, function (err, paths){
      paths.forEach(function (p, i) {
        fs.readFile(p, function (err, data) {
          if (err) { throw err; }
          state.totalFiles++;
          state.totalLines += numLines(data.toString());
          docs.push({ content: data.toString(), filePath: p, pi: i });
          if (docs.length === paths.length) { resolve(docs); }
        });
      });
    });
  });
}

function compare (docs) {
  let messages = [];
  let fullDocHashes = {};
  let allBlockHashes = {};

  for (let i = 0; i < docs.length; i++) {
    let iPOriginal = removeEmpty(makeParagraphArray(docs[i].content));
    let iP = normalize(iPOriginal);
    let hash = hashString(minify(docs[i].content));

    if (hash in fullDocHashes) {
      state.dupedLines += (numLines(docs[i].content) * 2);
      state.numFileDupes++;
      messages.push(new Message([docs[i].filePath, docs[fullDocHashes[hash]].filePath], 0, ''));
      continue;
    }

    fullDocHashes[hash] = i;

    for (let p = 0; p < iP.length; p++) {
      if (!isBigEnough(iPOriginal[p], (config.minLines - 1), config.minChars)) { continue; }
      let pHash = hashString(iP[p]);
      if (pHash in allBlockHashes) {
        let file1 = docs[i].filePath;
        let file2 = docs[fullDocHashes[allBlockHashes[pHash]]].filePath;
        state.dupedLines += (numLines(iPOriginal[p]) * 2);
        state.numParagraphDupes++;
        if (file1 === file2) {
          state.numParagraphDupesInFile++;
          messages.push(new Message([file1], 2, iPOriginal[p], pHash));
        } else if (hasDuplicateMsg(pHash, messages)) {
          continue;
        } else {
          messages.push(new Message([file1, file2], 1, iPOriginal[p], pHash));
        }
      } else {
        allBlockHashes[pHash] = hash;
      }
    }
  }

  return messages;
}

function report (messages) {
  let towelieScore = (100 - ((state.dupedLines / state.totalLines) *  100)).toFixed(2);
  messages.sort(function (a, b) {
    if (a.type > b.type) { return -1; }
    if (a.type < b.type) { return 1; }
    return 0;
  }).forEach(function (msg) {
    console.log(msg.toPlainEnglish());
  });

  console.table([
    {
      "Files Analyzed": state.totalFiles,
      "Lines Analyzed": state.totalLines,
      "Duplicate Files": state.numFileDupes,
      "Duplicate Blocks": state.numParagraphDupes,
      "Duplicate Blocks Within Files": state.numParagraphDupesInFile
    }
  ]);

  if (towelieScore < config.failureThreshold) {
    console.log(chalk.bgRed(`You failed your threshold of ${config.failureThreshold}% with a score of ${towelieScore}%`));
    process.exitCode = 1;
  } else {
    console.log(chalk.bgGreen(`You passed your threshold of ${config.failureThreshold}% with a score of ${towelieScore}%`));
  }
}

function hasDuplicateMsg (hash, msgs) {
  let isDupe = false;
  msgs.forEach(function (msg, ind) {
    isDupe = hash === msg.hash;
    if (isDupe) { return isDupe; }
  });
}

function updateDuplicateMsg (hash, content, msgs) {
  msgs.map(function (msg) {
    if (msg.hash === hash) { msg.content.push(content); }
    return msg;
  });
}

function isBigEnough (p, minLines, minChars) {
  return hasMoreNewlinesThan(p, minLines, true) && p.length > minChars;
}

function hashString (s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function makeParagraphArray (s) {
  return s.split('\n\n');
}

function hasMoreNewlinesThan (p, n, eq) {
  let matches = p.match(/\n/g);
  return eq ? (matches && matches.length >= n) : (matches && matches.length > n);
}

function numLines (s) {
  let matches = s.match(/n/g);
  return matches ? matches.length : 0; 
}

function normalize (arr) {
  return removeEmpty(arr).map(function (s) { return s.replace(/\s/g, ''); });
}

function removeEmpty (arr) {
  return arr.filter(function (arr) { return arr !== ''; });
}

function minify (s) {
  return s.replace(/(\n|\s)/g, '');
}