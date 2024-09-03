const cp = require("child_process");
const path = require("path");
const fs = require("fs");

function tool(cmdString, options) {
  return cp.execSync(cmdString, options).toString().trim();
}

function getMelangeLibPaths(melcWhere) {
  return melcWhere.split(path.delimiter);
}

const MerlinFileMap = new Map(); // parentDir of source -> merlin config
const starterMerlinFile = {
  files: new Set(),
  flags: ["-ppx melppx"],
  pkgs: new Set(["melange", "melange.js", "melange.dom", "melange.belt"]),
};
function getMerlinFileForParentDir(parentDir) {
  let merlinFile = MerlinFileMap.get(parentDir);
  if (!merlinFile) {
    return starterMerlinFile;
  } else return merlinFile;
}
function renderMerlinFile(merlinFile) {
  return Array.from(merlinFile.files)
    .map((f) => {
      return `S ${f.S}\nB ${f.B}`;
    })
    .concat(merlinFile.flags.map((f) => `FLG ${f}`))
    .concat([`PKG ${Array.from(merlinFile.pkgs).join(" ")}`])
    .join("\n");
}

class CommonCompilerCommand {
  constructor(cmd, includePaths) {
    this.cmd = cmd;
    this.includePaths = includePaths;
  }
  render() {
    const includeFlags = this.includePaths
      .map((x) => `-I ${x.trim()}`)
      .join(" ");
    return `${this.cmd} ${includeFlags} -ppx melppx`;
  }
}

class MelcCommand extends CommonCompilerCommand {
  constructor(melc, includePaths, dependencies) {
    super(melc, includePaths);
    this.dependencies = dependencies;
  }
  render(inputFilePath, outputFilePath) {
    const reasonSyntax = /.rei?$/.test(path.extname(inputFilePath));
    const pp = reasonSyntax ? '-pp "refmt --print binary"' : "";
    const impl = reasonSyntax ? `-impl ${inputFilePath}` : "";
    const dependencies = this.dependencies.length > 0 ? "-I ." : ""; // map((x) => `${x}.cmj`).join(" ");
    return `${super.render(
      inputFilePath,
    )} ${pp} ${impl} ${dependencies} -o ${outputFilePath}`;
  }
}

class OCamlDepCommand extends CommonCompilerCommand {
  constructor(melc, includePaths) {
    super(melc, includePaths);
  }
  render(inputFilePath) {
    const reasonSyntax = /.rei?$/.test(path.extname(inputFilePath));
    const pp = reasonSyntax ? '-pp "refmt --print binary"' : "";
    const impl = reasonSyntax ? `-impl ${inputFilePath}` : "";
    // esy ocamldep -ppx melppx -pp "refmt --print binary" -ml-synonym .re -mli-synonym .rei -impl ./Animation.re
    return `${super.render(
      inputFilePath,
    )} -bytecode -one-line ${pp} -ml-synonym .re -mli-synonym .rei ${impl}`;
  }
}

function compileDependenciesInThisDir(fileName, parentDir, rootContext) {
  const ocamldep = "esy ocamldep";
  const ocamldepOut = tool(new OCamlDepCommand(ocamldep, []).render(fileName), {
    cwd: parentDir,
  });
  const parts = ocamldepOut.split(":");
  let dependencies = [];
  if (parts.length > 1) {
    dependencies = parts[1]
      .trim()
      .split(" ")
      .map((x) => x.replace(".cmo", ""))
      .filter((a) => a !== "");
    return dependencies.map((m) => {
      const fullPath = path.join(parentDir, `${m}.re`);
      if (fs.existsSync(fullPath)) {
        return {
          m: m,
          mod: `${m}.re`,
          path: fullPath,
          js: path.join(parentDir, `${m}.js`),
        };
      } else {
        return {
          m: m,
          mod: `${m}.ml`,
          path: fullPath,
          js: path.join(parentDir, `${m}.js`),
        };
      }
    });
  } else {
    return dependencies;
  }
}

function checkIfEsyIsAvailable() {
  let possibleEsyPaths = [];
  try {
    possibleEsyPaths = process.env.PATH.split(path.delimiter).filter(
      (p) =>
        fs.existsSync(path.join(p, "esy")) ||
        fs.existsSync(path.join(p, "esy.cmd")) ||
        fs.existsSync(path.join(p, "esy.ps1")),
    );
  } catch (e) {
    console.warn(e);
    possibleEsyPaths = [];
  }

  if (possibleEsyPaths.length < 1) {
    throw new Error(
      "reason-loader needs esy. Checkout https://esy.sh to find the installation instructions.",
    );
  }
}

function replaceRequireWithCachedArtifact(buildPath, compiledJS, moduleName) {
  return compiledJS.replace(
    `require("./${moduleName}.js")`,
    `require("${path.join(buildPath, moduleName)}.js")`,
  );
}

function replaceRequires(buildPath, compiledJS, moduleName) {
  const compiledJSWithUppercaseReplaced = replaceRequireWithCachedArtifact(
    buildPath,
    compiledJS,
    moduleName,
  );
  return replaceRequireWithCachedArtifact(
    buildPath,
    compiledJSWithUppercaseReplaced,
    moduleName.toLowerCase(),
  );
}

function compile(_source) {
  // We wont support common package.json for now.
  // To support common package.json, we'll need to
  // figure a way to find a package's installPath
  // inside esy. Because, after all, with a common
  // package.json, esy will be host process inside
  // which this plugin will be running. Running esy,
  // inside a host esy process isn't stable (might
  // work, or may crash).
  // To be able to run inside esy, we need a build
  // system or findlib implementation that, when
  // given a package name, would return the installPath
  // We could call it: "melfind". Like ocamlfind.
  // Alternatively, we could patch ocamlfind to support
  // an additional "melc" subcommand like it's existing
  // ocamlc subcommand.
  // const { separateEsyJson } = this.getOptions();
  const file = this.resource;
  const parentDir = this.context;
  const fileName = path.relative(parentDir, file);
  const projectRoot = this.rootContext;
  const relativeDir = path.relative(projectRoot, parentDir);
  const cachePath = path.join(projectRoot, ".cache", "webpack-reason-loader");
  const buildPath = path.join(cachePath, relativeDir);

  fs.mkdirSync(buildPath, { recursive: true });

  checkIfEsyIsAvailable();

  try {
    if (!JSON.parse(tool(`esy status --json`)).isProjectReadyForDev) {
      console.log("esy dependencies haven't been fetched built. Running esy");
      cp.execSync("esy", { stdio: "inherit" });
    }
  } catch (e) {
    this.emitError(e);
    throw new Error(
      "Project's esy sandbox hasn't been built fully. Run 'esy' and reload.",
    );
  }
  const outputFileName = path
    .basename(file)
    .replace(".re", ".js")
    .toLowerCase();
  // Once we add support for common package.json, the following could be
  // just "melc"
  const melc = "esy melc";
  const melcWhere = tool(`${melc} -where`);
  const melangeLibPaths = getMelangeLibPaths(melcWhere);
  // HACK. melc -where doesn't emit belt path.
  // We dont have an easy way to figure where
  // Belt is installed.
  const melangeJsLibPath = melangeLibPaths[1];
  const melangeStdlibPath = melangeLibPaths[0];
  const melangeBeltLibPath = melangeJsLibPath
    .slice(0)
    .replace("lib/melange/js/melange", "lib/melange/belt/melange");
  const melangeDomLibPath = melangeJsLibPath
    .slice(0)
    .replace("lib/melange/js/melange", "lib/melange/dom/melange");
  const includePaths = [
    melangeStdlibPath,
    melangeJsLibPath,
    melangeDomLibPath,
    melangeBeltLibPath,
  ];
  // TODO: we could use something like the following to include only whats necessary
  // const includePaths = dependencyModules.reduce(
  // 	(includePaths, module) => {
  // 		switch (module) {
  // 			case "Belt":
  // 				includePaths.push(melangeBeltLibPath);
  // 			case "Js":
  // 				includePaths.push(melangeJsLibPath);
  // 			case "Dom":
  // 				includePaths.push(melangeDomLibPath);
  // 			default:
  // 		}
  // 		return includePaths;
  // 	},
  // 	[melangeStdlibPath],
  // );

  const modules = compileDependenciesInThisDir(
    fileName,
    parentDir,
    projectRoot,
  );
  modules.forEach((mod) => {
    this.addDependency(mod.path);
    compile.call(
      {
        resource: mod.path,
        context: parentDir,
        rootContext: this.rootContext,
        addDependency: this.addDependency.bind(this),
        addContextDependency: this.addContextDependency.bind(this),
      },
      "",
    );
  });
  const cmd = new MelcCommand(melc, includePaths, modules);
  cp.execSync(cmd.render(file, outputFileName), { cwd: buildPath });
  const merlinFile = getMerlinFileForParentDir(parentDir);
  merlinFile.files.add({
    S: parentDir,
    B: buildPath,
  });
  merlinFile.flags = merlinFile.flags.concat(
    includePaths.map((x) => `-I ${x.trim()}`),
  );
  fs.writeFileSync(
    path.join(this.context, ".merlin"),
    renderMerlinFile(merlinFile),
  );
  MerlinFileMap.set(parentDir, merlinFile);
  const compiledJS = fs
    .readFileSync(path.join(buildPath, outputFileName))
    .toString();
  // When a value exported from another module is used, (ie JS contains module.exports), it fails
  // Module not found: Error: Can't resolve './ball.js' in 'reason-ocaml-india.github.io/src/pages/mdn-game-tutorial'
  // We resolve './ball.js' to paths in .cache/webpack-reason-loader/...
  return modules.reduce(
    (compiledJSProcessed, m) =>
      replaceRequires(buildPath, compiledJSProcessed, m.m),
    compiledJS,
  );
}

module.exports = compile;
