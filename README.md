# The Intern website

First, run `npm install` to install dependencies.

## Developing

To start a local testing server, run:

```
npm start
```

To build the site into `public/`, run:

```
npm run build
```

To build a production version of the site with minified/inlined resources, run:

```
npm run build production
```

## Publishing

The site source lives in the `source` branch, while the actual published code is in master. To publish an updated version of the site (assuming this copy of the repo was cloned directly from GitHub):

```
npm run publish
git push origin master
```

The `publish` script will clone this repo into the `public/` subdirectory and check out the `master` branch, build the site into it, commit the changes, and pull those changes back into this instance of the repo. The push command just pushes the updated `master` branch to GitHub, making the changes live.
