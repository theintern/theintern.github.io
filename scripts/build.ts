import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { createInterface } from 'readline';
import { format } from 'util';
import webpack from 'webpack';
import webpackConfig from '../webpack.config';
import WebpackMiddleware from 'webpack-dev-middleware';
import BrowserSync from 'browser-sync';
import Metalsmith, { Plugin } from 'metalsmith';
import layouts from 'metalsmith-layouts';
import sass from 'metalsmith-sass';
import autoprefixer from 'metalsmith-autoprefixer';
import assets from 'metalsmith-assets';
import inPlace from 'metalsmith-in-place';
import { inlineSource } from 'inline-source';
import stripAnsi from 'strip-ansi';
import { sync as rimraf } from 'rimraf';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const baseDir = dirname(__dirname);
const publishDir = join(baseDir, '_publish');
const publicDir = join(baseDir, '_public');
const siteDir = join(baseDir, 'site');
const assetsDir = join(baseDir, 'assets');

async function prompt(...args: any[]) {
  const question = format(args[0], ...args.slice(1));
  return new Promise<string>(function(resolve) {
    rl.question(question, resolve);
  });
}

(async () => {
  let publish = false;
  let serve = false;
  let remote = 'origin';

  process.argv.slice(2).forEach(arg => {
    if (arg === 'serve') {
      serve = true;
    } else if (/^publish=?/.test(arg)) {
      publish = true;
      // Always publish production code
      process.env.NODE_ENV = 'production';
    } else if (/^remote=/.test(arg)) {
      remote = arg.split('=')[1];
    } else if (/\bhelp$/.test(arg) || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown option "${arg}"\n`);
      printUsage();
      process.exit(1);
    }
  });

  if (serve && publish) {
    console.error('Only one of "serve" and "publish" may be specified');
    process.exit(1);
  }

  if (serve) {
    await runMetalsmith();
    runServer();
  } else if (publish) {
    if (existsSync(publishDir)) {
      console.log(`Removing existing publish dir ${relative('.', publishDir)}`);
      rimraf(publishDir);
    }

    console.log(
      `Creating a clone of the master branch in ${relative('.', publishDir)}`
    );
    execSync(`git clone -q . ${publishDir}`);
    execSync('git checkout -q master', { cwd: publishDir });

    await runMetalsmith({ destination: publishDir, clean: false });
    await runWebpack({ destination: publishDir });

    const answer = await prompt(
      `Please confirm build success and make any desired changes in ${publishDir}.` +
        ' When finished, enter "y" to push to master. Enter any other key to bail.\n> '
    );

    if (answer === 'y') {
      console.log('Publishing...');
      const { status } = spawnSync('git', ['diff', '--quiet', 'HEAD'], {
        cwd: publishDir
      });
      if (status !== 0) {
        execSync('git add .', { cwd: publishDir });
        execSync('git commit --all -m "Updated doc build"', {
          cwd: publishDir
        });
        execSync(`git fetch ${publishDir} master:master`);
        if (remote) {
          execSync(`git push ${remote} master`);
          console.log('Published!');
        } else {
          console.log('Master was updated, but nothing was pushed.');
        }
      } else {
        console.log('Nothing to publish (no changes)');
      }
    } else {
      console.log('Not publishing');
    }
  } else {
    await runMetalsmith();
    await runWebpack();
  }
  rl.close();
})().catch(error => {
  console.error('Build failed!');
  console.error(error);
  rl.close();
});

function runServer() {
  webpackConfig.output!.path = resolve(publicDir);
  const browserSync = BrowserSync.create();
  const compiler = webpack(webpackConfig);
  const webpackMiddlware = WebpackMiddleware(compiler, {
    publicPath: webpackConfig.output!.publicPath!,
    stats: false
  });

  compiler.plugin('done', (stats: webpack.Stats) => {
    if (stats.hasErrors() || stats.hasWarnings()) {
      return (<any>browserSync).sockets.emit('fullscreen:message', {
        title: 'Webpack error:',
        body: stripAnsi(stats.toString()),
        timeout: 100000
      });
    } else {
      console.log('Webpack finished');
      browserSync.reload();
    }
  });

  browserSync.init({
    server: { baseDir: publicDir },
    open: false,
    notify: false,
    logFileChanges: true,
    middleware: [webpackMiddlware],
    plugins: ['bs-fullscreen-message'],
    files: [
      `${publicDir}/**/*`,
      {
        match: [`${siteDir}/**/*`, `${assetsDir}/**/*`],
        fn: () => {
          // Don't clean when rebuilding while serving
          runMetalsmith({ clean: false }).catch(error => {
            console.error('Build failed!');
            console.error(error);
          });
        }
      }
    ]
  });
}

function runWebpack(options?: { destination?: string }) {
  console.log('Running webpack...');

  const { destination = publicDir } = options || {};
  webpackConfig.output!.path = resolve(destination);

  return new Promise((resolve, reject) => {
    webpack(webpackConfig, (err: Error, stats: webpack.Stats) => {
      if (err) {
        reject(err);
      } else if (stats.hasErrors()) {
        const info = stats.toJson();
        reject(new Error(info.errors.join(', ')));
      } else {
        console.log('Webpack finished');
        resolve();
      }
    });
  });
}

async function runMetalsmith(options?: {
  clean?: boolean;
  destination?: string;
}) {
  console.log('Running Metalsmith...');

  const { clean = true, destination = publicDir } = options || {};
  const production = process.env.NODE_ENV === 'production';

  const renameHtml: Plugin = files => {
    for (const filename of Object.keys(files)) {
      if (/\.html\.ejs$/.test(filename)) {
        const newName = filename.replace(/\.ejs$/, '');
        files[newName] = files[filename];
        delete files[filename];
      }
    }
  };

  const docSets: Plugin = (files, metalsmith, done) => {
    if (files['docs.json']) {
      const data = files['docs.json'].contents.toString('utf8');
      const docSets = JSON.parse(data);
      const metadata = metalsmith.metadata() as any;
      metadata.docSets = docSets;
      metadata.guideLink = `/docs.html#Intern/${docSets['Intern'].latest}`;
      delete files['docs.json'];
    }
    done(null, files, metalsmith);
  };

  // Remove any files from the files list that have equivalent contents to
  // existing files.
  const copyCheck: Plugin = (files, metalsmith, done) => {
    const dest = metalsmith.destination();
    const names = Object.keys(files);
    for (let name of names) {
      const file = join(dest, name);
      if (existsSync(file)) {
        const contents = readFileSync(file);
        if (files[name].contents.equals(contents)) {
          delete files[name];
        }
      }
    }
    done(null, files, metalsmith);
  };

  const inlineSources: Plugin = (files, metalsmith, done) => {
    const options = { rootpath: assetsDir };
    const htmlFileNames = Object.keys(files).filter(path =>
      /\.html$/.test(path)
    );
    Promise.all(
      htmlFileNames.map(path => {
        const file = files[path];
        inlineSource(file.contents.toString(), options).then(data => {
          file.contents = Buffer.from(data);
        });
      })
    ).then(() => done(null, files, metalsmith));
  };

  const metalsmith = Metalsmith(__dirname)
    .metadata({
      site: {
        name: 'The Intern',
        description: 'Software testing for humans'
      },
      pageType: 'default',
      bodyClass: '',
      production: production
    })
    .source(siteDir)
    .destination(destination)
    .clean(clean)
    // don't auto-process files in site/layouts
    .ignore('layouts')
    .use(docSets)
    // apply templates to files
    .use(
      layouts({
        engine: 'ejs',
        directory: join(siteDir, 'layouts'),
        default: 'default.ejs',
        pattern: '**/*.{html,ejs}'
      })
    )
    // process ejs directives in files
    .use(inPlace({ setFilename: true }))
    .use(
      sass({
        outputStyle: production ? 'compressed' : 'expanded',
        sourceMap: !production,
        sourceMapContents: true,
        outputDir: 'css'
      })
    )
    .use(autoprefixer())
    .use(renameHtml)
    .use(inlineSources)
    .use(
      assets({
        source: assetsDir,
        destination: destination
      })
    )
    .use(copyCheck);

  const build = new Promise((resolve, reject) => {
    metalsmith.build(error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  await build;
  console.log('Metalsmith finished');
}

function printUsage() {
  console.log('usage: build [serve | publish [remote=xyz]]');
  console.log('  serve   - start a dev server');
  console.log('  publish - build and publish the site');
  console.log('  remote  - git remote to push to when publishing');
}
