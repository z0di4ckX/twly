#!/usr/bin/env node
'use strict';

var cli = require('commander');
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

cli
  .option('-f, --files [glob]', 'Files you would like to analyze', '**/*.*')
  .option('-t, --threshold [integer or floating point]', 'Specify the point at which you would like Towelie to fail')
  .option('-l, --lines [integer]', 'Minimum number of lines a block must have to be compared')
  .option('-c, --chars [integer]', 'Minimum number of characters a block must have to be compared')
  .parse(process.argv);
  
init();

function init () {
  // Length of three indicates that only one arg passed. All of our options require values, so we assume then it was a glob.
  let glob = process.argv.length === 3 ? process.argv[2] : cli.files;
  // We show towelie picture for fun
  console.log(chalk.green(towelie));

  /*
    This application has 4 different stages: (1) configure (2) read (3) compare the contents
    and (4) report towlie's findings. In stage 2, read, we pass in the global variable "config", required above, 
    otherwise we are just piping functions
  */
  configure()
    .then(function (config) { return read(glob.toString(), config); })
    .then(function (docs){ return compare(docs); })
    .then(function (messages){ return report(messages); })
    .catch(function (err) { throw err; });
}

function configure () {
  return new Promise(function (resolve, reject) {
    // Attempt to read the .trc file, which is the designated name for a twly config file
    fs.readFile(process.cwd() + '/.trc', 'utf-8', function (err, data) {
      let o = { ignore: [] };

      function addIgnoreGlobs (p) { o.ignore.push(path.join(process.cwd(), p)); }

      if (err) {
        o = config;
      } else {
        // The required format of the config file is JSON
        let userConf = JSON.parse(data);
        let ignore = userConf.ignore;
        // If user supplied ignore values, we get their fully qualified paths and add them to ignore array
        ignore && ignore.forEach(addIgnoreGlobs);
        /*
          Checking for the existence of individual properties and copying over their values if they exist
          Giving preference to values defined via CLI
        */
        if (userConf.failureThreshold) { config.failureThreshold = userConf.failureThreshold; }
        if (userConf.minLines) { config.minLines = userConf.minLines; }
        if (userConf.minChars) { config.minChars = userConf.minChars; }
      }

      if (cli.threshold) { config.failureThreshold = cli.threshold; }
      if (cli.lines) { config.minLines = cli.lines; } 
      if (cli.chars) { config.minChars = cli.chars; }

      resolve(o);
    });
  });
}

function read (pathsToRead, config) {
  return new Promise(function (resolve, reject) {
    let docs = [];
    glob(path.join(process.cwd(), pathsToRead), config, function (err, paths) {
      paths.forEach(function (p, i) {

        /*
          Reading in all documents and only firing off the comparison once all have been read.
          This is signaled by invoking the promise's resolve function and passing it an array of documents. 
        */
        fs.readFile(p, function (err, data) {
          if (err) { 
            console.log(chalk.red(`Error reading file "${p}"`))
            throw err;
          }
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

    /*
      We check if the hash of ALL of the minified content in current document already exists in our array of hashes
      If it does, that means we have a duplicate of an entire document, so we check to see if there is a message with 
      that hash as a reference, and if there is then we add the docpath to the message... otherwise just add message
    */
    if (hash in fullDocHashes) {
      let existingMsgInd = fullDocHashes[hash].msgInd;
      if (existingMsgInd >= 0) {
        let msg = messages[existingMsgInd];
        (msg.docs.indexOf(docs[i].filePath) === -1) && msg.docs.push(docs[i].filePath);
      } else {
        // Sort of clever: before augmenting the length of the array by pushing to it, I am grabbing the current length for that index
        fullDocHashes[hash].msgInd = messages.length;
        messages.push(new Message([docs[i].filePath, docs[fullDocHashes[hash].ind].filePath], 0, '', hash));
      }
      // Increment the relevant counters for reporting
      state.dupedLines += numLines(docs[i].content);
      state.numFileDupes++;
      /*
        If we don't continue here, then we will start matching the paragraphs of files which are pure duplicates
        However, if we do continue, then if a different file shares a fragment with the current file, we will not realize.
        The solution might be to not continue here, but skip blocks who have hashes that map files which are perfect duplicates,
        so check below at match time... a duplicate message will have already been created
      */
      continue;
    } else {
      // We don't add to the hashes array above because no need for possible redundancy
      fullDocHashes[hash] = { ind: i };
    }

    // We iterate over iP which is the current document's paragraphs
    for (let p = 0; p < iP.length; p++) {
      // First we must check if this paragraph is even worth checking, as we have config params which set some criteria for the content size
      if (!meetsSizeCriteria(iPOriginal[p], (config.minLines - 1), config.minChars)) { continue; }
      
      let pHash = hashString(iP[p]);
      /*
        Checking if minified paragraph hash exists in array of all paragraph hashes. If it doesn't
        then we just add the hash to the global block/paragraph hash array. If it does then we need to know
        if it has simply been added there or also has a message associated with it.
      */
      if (pHash in allBlockHashes) {
        // Current file of main file loop
        let file1 = docs[i].filePath;
        // File which had a paragraph that was matched in the allBlockHashes array
        let file2 = docs[fullDocHashes[allBlockHashes[pHash]].ind].filePath;
        let inSameFile = file1 === file2;
        let dupeMsgInd = findDuplicateMsgInd(pHash, messages);

        if (inSameFile) {
          messages.push(new Message([file1], 2, iPOriginal[p], pHash));
        } else if (dupeMsgInd === -1) { // <--- Dupe message NOT found
          /*
            Need to figure out if there is a message with the same files for a message we are about to write,
            and if so, add the content to that message. TODO We also need to be able to add that content's hash to an array
            of hashes instead of just a single hash so that we can pick up duplicate content still.
          */
          let dupeMsgInd = getMsgIndByFiles([file1, file2], messages);
          if (dupeMsgInd === -1) {
            messages.push(new Message([file1, file2], 1, iPOriginal[p], pHash));
          } else {
            messages[dupeMsgInd].content.push(iPOriginal[p]);
            messages[dupeMsgInd].hashes.push(pHash);
          }
        } else {
          let msg = messages[dupeMsgInd];
          /*
            If there was a match for paragraph hashes AND the paragraphs were NOT in the same file AND
            a message with current paragraph hash WAS FOUND THEN there are multiple files with the same 
            paragraph in them and we must add the filename to the files array of the pre-existing message
          */
          (msg.docs.indexOf(file1) === -1) && msg.docs.push(file1);
        }

        inSameFile && state.numParagraphDupesInFile++;
        state.dupedLines += numLines(iPOriginal[p]);
        state.numParagraphDupes++;
      } else {
        /*
          Assigning the value of the pHash in the index object to the document hash because we want to be able to look up the correct index
          for the doc in the docs array and to get that index we look at the full document hash index object with the document hash as its key
        */
        allBlockHashes[pHash] = hash;
      }
    }
  }

  /*
    We just return a value here instead of resolving a promise, because we are not in a promise and do not
    need one because the above operations are synchronous
  */
  return messages;
}

function report (messages) {
  state.numFileDupes = state.numFileDupes === 0 ? state.numFileDupes : (state.numFileDupes + 1);
  let towelieScore = (100 - ((state.dupedLines / state.totalLines) *  100)).toFixed(2);
  /*
    We want the full file duplicates at the bottom so that full aggregiousness is realized,
    so we sort the messages array based on message.type which is an int
  */
  messages.sort(function (a, b) {
    if (a.type > b.type) { return -1; }
    if (a.type < b.type) { return 1; }
    return 0;
  }).forEach(function (msg) {
    // This is where we print the individual violations "messages"
    console.log(msg.toPlainEnglish());
  });

  // This is a tabular summary of some of the metrics taken throughout the process
  console.table([
    {
      "Files Analyzed": state.totalFiles,
      "Duplicate Files": state.numFileDupes,
      "Lines Analyzed": state.totalLines,
      "Duplicate Lines": state.dupedLines,
      "Duplicate Blocks": state.numParagraphDupes,
      "Duplicate Blocks Within Files": state.numParagraphDupesInFile
    }
  ]);

  // The end. How did you do?
  if (towelieScore < config.failureThreshold) {
    console.log(chalk.bgRed(`You failed your threshold of ${config.failureThreshold}% with a score of ${towelieScore}%`));
    process.exitCode = 1;
  } else {
    console.log(chalk.bgGreen(`You passed your threshold of ${config.failureThreshold}% with a score of ${towelieScore}%`));
  }
}

// Utility functions used throughout the above code ^^^
function findDuplicateMsgInd (hash, msgs) {
  let dupeInd = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].hashes && msgs[i].hashes.indexOf(hash) > -1) {
      dupeInd = i;
      break;
    }
  }

  return dupeInd;
}

function getMsgIndByFiles (files, msgs) {
  let ind = -1;
  
  for (let m = 0; m < msgs.length; m++) {
    let hasAllFiles = false;
    files.forEach(function (file, f) {
      hasAllFiles = msgs[m].docs.indexOf(file) > -1;
    });
    if (hasAllFiles) { ind = m; break;}
  }
  return ind;
}

function hasMoreNewlinesThan (p, n, eq) {
  let matches = p.match(/\n/g);
  return eq ? (matches && matches.length >= n) : (matches && matches.length > n);
}

function numLines (s) {
  let matches = s.match(/\n/g);
  return matches ? matches.length : 0; 
}

function meetsSizeCriteria (p, minLines, minChars) {
  return hasMoreNewlinesThan(p, minLines, true) && p.length > minChars;
}

function hashString (s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function makeParagraphArray (s) {
  return s.split('\n\n');
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