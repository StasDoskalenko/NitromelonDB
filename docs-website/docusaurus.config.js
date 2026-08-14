// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes } = require('prism-react-renderer')
const lightTheme = themes.github
const darkTheme = themes.dracula
const { version } = require('./package.json')

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'NitromelonDB',
  tagline: 'A reactive database framework',
  favicon: 'img/favicon.ico',

  // GitHub Pages: https://stasdoskalenko.github.io/NitromelonDB/
  url: 'https://stasdoskalenko.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/NitromelonDB/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'StasDoskalenko', // Usually your GitHub org/user name.
  projectName: 'NitromelonDB', // Usually your repo name.
  deploymentBranch: 'gh-pages',

  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: 'https://github.com/StasDoskalenko/NitromelonDB/edit/master/docs-website/',
          routeBasePath: '/',
          path: 'docs',
          lastVersion: 'current',
          versions: {
            current: {
              label: `${version}`,
              badge: true,
            },
          },
        },
        // blog: {
        //   showReadingTime: true,
        //   // Please change this to your repo.
        //   // Remove this to remove the "edit this page" links.
        //   editUrl:
        //     'https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/',
        // },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/watermelon-social-card.png',
      navbar: {
        title: 'NitromelonDB',
        logo: {
          alt: 'NitromelonDB Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'doc',
            position: 'left',
            label: 'Docs',
            docId: 'docs/README',
          },
          {
            type: 'docsVersionDropdown',
            position: 'left',
          },
          // {to: '/blog', label: 'Blog', position: 'left'},
          {
            href: 'https://github.com/StasDoskalenko/NitromelonDB',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Installation',
                to: '/docs/Installation',
              },
              {
                label: 'Migrating from WatermelonDB',
                to: '/docs/Migrating',
              },
              // {
              //   label: 'Advanced Guides',
              //   to: '/docs/Advanced/Migrations',
              // },
              {
                label: 'Contributing',
                to: '/docs/CONTRIBUTING',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Stack Overflow',
                href: 'https://stackoverflow.com/questions/tagged/watermelondb',
              },
              // {
              //   label: 'Discord',
              //   href: 'https://discordapp.com/invite/docusaurus',
              // },
              {
                label: 'Twitter',
                href: 'https://twitter.com/radexp',
              },
            ],
          },
          {
            title: 'More',
            items: [
              // {
              //   label: 'Blog',
              //   to: '/blog',
              // },
              {
                label: 'GitHub',
                href: 'https://github.com/StasDoskalenko/NitromelonDB',
              },
            ],
          },
        ],
        copyright: `NitromelonDB is a fork of WatermelonDB by <a href="https://radex.io">Radek Pietruszewski</a> and <a href="https://nozbe.com">Nozbe</a>.`,
      },
      prism: {
        theme: lightTheme,
        darkTheme: darkTheme,
      },
    }),
}

module.exports = config
