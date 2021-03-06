<table>
<tr>
<td>
<img width="150" src="https://github.com/rdgd/twly/raw/master/assets/towel.png" alt="You're a towel" />
</td>
<td><a href="https://nodei.co/npm/twly/"><img src="https://nodei.co/npm/twly.png"></a></td>

</tr>
</table>
<td>

# twly?

<b>twly</b> (pronounced "towel-E") is a static analysis tool which can help you keep your code DRY (Don't Repeat Yourself) by letting you know where you have copy and pasted entire files or portions of them. Run twly on a directory, and twly will magically generate a report for you indicating what has been repeated and in which files. twly is language agnostic and can be used on any text document.
</td>

# Installation

`npm install -g twly` or to include in some project `npm install twly --save-dev`

# Configuration
twly has some default configuration, which translates into following configuration JSON object

```
  {
    "threshold": 95,
    "ignore": ["node_modules/**/*.*", "bower_components/**/*.*", ".git/**/*.*"],
    "minLines": 4,
    "minChars": 100
  }
```

twly reads the config file `.trc`. This file should contain a JSON object. For example, below is an example `.trc` file if you wanted to do the following:
* Ignore the specific files foo.txt and bar.txt as well as all of the content in your node_modules directory
* Exit with a status code of 1 (failure) if under 89.5 percent of files are unique
* Only match blocks of code that have are at least 7 lines large with a minimum of 200 characters

```
  {
    "threshold": 89.5,
    "ignore": ["foo.txt", "bar.txt", "node_modules/**"],
    "minLines": 7,
    "minChars": 200
  }
```

# Usage

You can use twly by simply running the command `twly`. This will analyze all the files and recurse into subdirectories in your current working directory by default. You can also pass twly a glob pattern... If for example you wanted all javascript files in your current directory and all subdirectories: `twly '**/*.js'`. This will analyze all CSS files in your current working directory `twly '*.css'`.

For a list of available CLI arguments run command `twly --help`.

See the [node-glob](https://github.com/isaacs/node-glob) project for options on how to specify files.

# Contributing
## Automated Builds
* A build for the project is run in Jenkins every hour
* You can view the latest build [here](https://ciserver.me/job/twly-test)

## Code Style and Tests... automate it
* `npm install:hooks`
* This will install a precommit hook that will run lint and tests every time you make a commit

## Introducing Changes
* Cut a branch off of develop, name it whatever you want
* Try to keep the number of changes introduced in a branch to a reasonably defined scope
* Make sure the tests pass
* Write tests for any new pure functions you create
* Make a PR with `develop` as the merge target
* I schedule releases on a discretionary basis

## Issues
* If you notice any issues with the library, post in the issues section with as clear and detailed a report as possible
* If you address any open issues in a PR, please note it in the commit which fixes it and/or the PR body

## Understanding Key Data Structures
`allBlockHashes` is an object with `blockHash` as key and the value is is an object with a `docIndexes` array for looking up the corresponding documents which contain that block in the `docs` array and `msgInd` for looking up the corresponding message in the `messages` array.

`fullDocHashes` is an object with `docHash` as a key and the value is an object with `docInd` for looking up the corresponding document in the `docs` array and `msgInd` for looking up the corresponding message in the `messages` array.

