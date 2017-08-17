const Metalsmith = require('metalsmith');
const layouts = require('metalsmith-layouts');
const sass = require('metalsmith-sass');
const autoprefixer = require('metalsmith-autoprefixer');
const assets = require('metalsmith-assets');
const browserSync = require('metalsmith-browser-sync');
const inlineSource = require('metalsmith-inline-source');
const ts = require('typescript');
const uglifyJs = require('uglify-js');
const { execSync } = require('child_process');

let publish = false;
let serve = false;
let production = false;

process.argv.slice(2).forEach(arg => {
	switch (arg) {
	case 'serve':
		serve = true;
		break;
	case 'production':
		console.log('Building for production');
		production = true;
		break;
	case 'publish':
		publish = true;
		production = true;
		break;
	case 'help':
	case '-h':
	case '--help':
		printUsage();
		process.exit(0);
		break;
	default:
		console.error(`Unknown option "${arg}"\n`);
		printUsage();
		process.exit(1);
	}
});

if (serve && publish) {
	console.error('Only one of "serve" and "publish" may be specified');
	process.exit(1);
}

const metalsmith = new Metalsmith(__dirname)
	.metadata({
		site: {
			name: 'The Intern',
			description: 'Software testing for humans'
		},
		pageType: 'default',
		bodyClass: '',
		production
	})
	.source('./src')
	.destination('./public')
	.use(docsets())
	.use(buildTypescript())
	.use(
		layouts({
			engine: 'ejs',
			directory: './src/layouts',
			default: 'default.ejs',
			pattern: '**/*.html'
		})
	)
	.use(
		sass({
			outputStyle: production ? 'compressed' : 'expanded',
			sourceMap: !production,
			sourceMapContents: true,
			outputDir: 'css'
		})
	)
	.use(autoprefixer())
	.use(
		inlineSource({
			rootpath: './src/assets'
		})
	)
	.use(
		assets({
			source: './src/assets'
		})
	);

if (production) {
	metalsmith.use(uglify());
}

if (serve) {
	metalsmith.use(
		browserSync({
			server: './public',
			files: ['./src/**/*', './resources/**/*'],
			open: false,
			notify: false
		})
	);
}

if (publish) {
	console.log('Creating a clone of the master branch');
	execSync('git clone -q . public');
	execSync('git checkout -q master', { cwd: 'public' });
}

metalsmith.build(function(error) {
	if (error) {
		console.log(error);
	} else {
		console.log('Built!');

		if (publish) {
			execSync('git add .', { cwd: 'public' });
			execSync('git commit --all -m "Updated doc build"', { cwd: 'public' });
			execSync('git fetch public master:master'); 
			console.log('Publishing');
		}
	}
});

function buildTypescript() {
	return (files, metalsmith, done) => {
		const compilerOptions = {
			target: 1, // es5
			module: 0, // none
			lib: [
				'lib.dom.d.ts',
				'lib.es5.d.ts',
				'lib.es2015.iterable.d.ts',
				'lib.es2015.promise.d.ts'
			],
			strict: true,
			noUnusedLocals: true,
			noUnusedParameters: true,
			noImplicitReturns: true,
			noFallthroughCasesInSwitch: true,
			inlineSourceMap: true,
			inlineSources: true,
			outDir: './public',
			types: [
				'highlight.js',
				'markdown-it'
			]
		};

		if (metalsmith.metadata().production) {
			compilerOptions.inlineSourceMap = false;
		}

		const source = files['doc_viewer.ts'].contents.toString('utf8');
		let result = ts.transpileModule(source, { compilerOptions, fileName: 'doc_viewer.ts' });
		delete files['doc_viewer.ts'];
		files['doc_viewer.js'] = { contents: Buffer.from(result.outputText) };
		done();
	};
}

function docsets() {
	return (files, metalsmith, done) => {
		const data = files['docs.json'].contents.toString('utf8');
		metalsmith.metadata().docsets = JSON.parse(data);
		delete files['docs.json'];
		done();
	};
}

function uglify() {
	return (files, metalsmith, done) => {
		const jsFiles = Object.keys(files).filter(name => /\.js$/.test(name));
		jsFiles.forEach(name => {
			const data = files[name].contents.toString('utf8');
			const newData = uglifyJs.minify(data);
			files[name].contents = Buffer.from(newData.code);
		});
		done();
	};
}

function printUsage() {
	console.log('usage: build [serve | publish] [production]');
	console.log('  serve      - start a dev server');
	console.log('  publish    - build and publish the site');
	console.log('  production - build in production mode');
}
