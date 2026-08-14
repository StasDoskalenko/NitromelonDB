import Link from '@docusaurus/Link'
import useBaseUrl from '@docusaurus/useBaseUrl'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import HomepageFeatures from '@site/src/components/HomepageFeatures'
import { Redirect } from '@docusaurus/router'
import Layout from '@theme/Layout'
import clsx from 'clsx'
import React from 'react'

import styles from './index.module.css'

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext()
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  )
}

export default function Home() {
  // GitHub Pages is served from /NitromelonDB/. @docusaurus/router Redirect does
  // not prefix baseUrl, so a root-absolute `/docs` would 404 at
  // https://stasdoskalenko.github.io/docs instead of
  // https://stasdoskalenko.github.io/NitromelonDB/docs
  const docsPath = useBaseUrl('/docs')
  return <Redirect to={docsPath} />
  // return (
  //   <Layout
  //     description="WatermelonDB is a performant, scalable, and easy-to-use database for React and React Native apps.">
  //     <HomepageHeader />
  //     <main>
  //       <HomepageFeatures />
  //     </main>
  //   </Layout>
  // )
}
