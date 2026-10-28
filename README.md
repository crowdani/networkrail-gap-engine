# Yarn Offline Mirror

This package contains a Yarn offline mirror with private npm packages provided by the package provider.

## Setup Instructions

### Install requirements

Use NVM (node version manager) and set to node 20
https://nodejs.org/en/download


```
nvm install v20
```

Install these packages globally (some graphite tools will use them and expect them to be installed globally)

```
npm install -g yarn shx shelljs eslint
```

### Quick Setup

Ensure you have your Maximo sources downloaded and extracted from the Maximo Application Configuration tool.

Download and extract the offline cache files to a location of your choice.

Navigate to your Maximo project directory (where your package.json file is located) and run the included configure script:

```bash
cd /path/to/your/maximo/project
node /path/to/extracted/offline-cache/configure.cjs
```

The configure script will:
- Update your package.json with the correct package versions from vendorized packages
- Configure your .yarnrc file to use the offline mirror
- Set up file: references for @maximo packages to use the vendorized versions

## Included Packages

The following packages are included in this offline mirror:

- @maximo/react-components@3.2.849
- @maximo/app-processor@3.2.849
- @maximo/maximo-js-api@3.2.849
- @maximo/maxdev-cli@4.1.14
- @maximo/graphite-cli@4.1.1
- @maximo/eslint-plugin-graphite@4.0.2
- @maximo/maximo-library@3.2.849
- @maximo/map-component@3.2.50
- @maximo/treegrid@3.2.22
- @maximo/graphite-common-solution-components@3.2.60

Your package.json will be scanned and updated to use these library versions.

## Usage

After configuration, simply run:

```bash
yarn install
```

Yarn will automatically use the offline mirror and vendorized packages.

## Development

After setting up your project with the offline mirror, you can use the following commands for development:

### Core Tasks

```bash
# Transform your XML into JavaScript code
yarn build

# Start the preview server (will display the local port in the console)
yarn start

# Create a production build of your application
yarn build:production
```

These commands leverage the Maximo Application Framework to help you develop, test, and build your application.

### Connecting to a Remote Maximo Server

To connect your local development environment to a remote Maximo server for data, you can use the graphite-cli proxy command:

```bash
# Set up a .env file with connection details to a remote Maximo server
npx @maximo/graphite-cli proxy
```

This command will:
1. Prompt you for the URL of your Maximo server
2. Ask for authentication details
3. Create a `.env` file in your project directory
4. Configure your local application to use the remote server for data while running locally

This allows you to develop and test your application with real data without deploying to the server.

## Troubleshooting

### Package Not Found

If Yarn can't find a package in the offline mirror:

1. Verify the package is included in the list above.
2. Check your `.yarnrc` configuration.
3. Try clearing Yarn's local cache and reinstalling:

```bash
yarn cache clean
node /path/to/extracted/offline-cache/configure.cjs
yarn install
```

### 3rd party libraries

Do not include 3rd party libraries with your project.  If you do, it will not be compatible with the Maximo Configuration tools.

### Version Conflicts

If you encounter version conflicts:

1. Check the exact versions available in the offline mirror and vendors directory.
2. Update your package.json to use a specific version that's available (configure.cjs should do this automatically).

## Example Folder Structure

Here's an example of how you might organize your projects to share the offline cache:

```
/development/
├── yarn-offline-cache/        # The extracted offline cache files
│   ├── configure.cjs          # Configuration script
│   ├── offline-mirror/        # Cached .tgz packages
│   ├── vendors/               # Extracted @maximo packages
│   └── ...
│
├── project1/                  # First Maximo project
│   ├── package.json           # References vendorized packages
│   ├── .yarnrc                # Configured to use the offline cache
│   └── ...
│
└── project2/                  # Second Maximo project
    ├── package.json           # Also references vendorized packages
    ├── .yarnrc                # Also configured to use the offline cache
    └── ...
```

When you configure each project, navigate to the project directory and run the configure script:
```bash
cd project1
node ../yarn-offline-cache/configure.cjs

cd ../project2
node ../yarn-offline-cache/configure.cjs
```

### Sharing Between Projects

1. Extract the offline cache once to a central location (e.g., `/development/yarn-offline-cache/`).
2. For each project:
   - Navigate to the project directory
   - Run the configure script
3. The configure script will set up each project to use the same offline cache and vendorized packages.

This approach allows you to:
- Save disk space by maintaining only one copy of the dependencies
- Ensure consistency across projects by using the same package versions
- Quickly set up new projects without re-downloading packages
- Run the configure script multiple times safely (it's idempotent)

## Additional Notes

- Yarn will use the offline mirror for the packages listed above
- Other packages will still be downloaded from the public npm registry
- If you need additional private packages, please contact the package provider
