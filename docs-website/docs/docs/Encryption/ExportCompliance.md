---
title: 'App Store and export compliance'
sidebar_label: 'Export compliance'
hide_title: true
description: "What the encryption build means for App Store export compliance: Apple's categories, the French declaration, and the Info.plist keys. Not legal advice."
---

# App Store and export compliance

:::danger Not legal advice
This section explains what we know and where to look. Export rules differ by country and change over time, and your obligations depend on your app and where you distribute it. Check Apple's current guidance, and ask someone qualified if you are unsure.
:::

**The App Store does not forbid encryption.** Many approved apps bundle their own cryptography (SQLCipher, Realm's encrypted databases, Signal, anything built on OpenSSL). What Apple asks about is **export compliance**: when you upload an app, you export it from the US, and an app that contains encryption is subject to US export rules (and to the import rules of the countries you distribute in). So App Store Connect asks about encryption for every new version, and the answer covers your app **"including any third-party libraries it links against"**, in Apple's words. That sentence is the reason the cipher is opt-in.

**With the default build**, NitromelonDB adds no cryptography to your app. Whatever you answer Apple today stays correct.

**With the encryption build**, your app contains encryption that isn't part of iOS: NitromelonDB's bundled AES-256, HMAC-SHA512 and PBKDF2-HMAC-SHA512. These are industry-standard algorithms (published, and accepted by standards bodies), used to protect your app's own data at rest.

Apple's [reference table](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption) sorts apps into three cases:

| Your app uses                                                                                         | Documentation Apple asks for                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| only encryption within Apple's operating system (HTTPS with `URLSession`, CommonCrypto, the Keychain) | none                                                                                 |
| **an industry-standard algorithm not provided by the operating system**: the encryption build         | a French encryption declaration, **only if** you distribute in France                |
| proprietary algorithms not accepted by standards bodies                                               | a US classification (CCATS), plus the French declaration if you distribute in France |

So with the encryption build, expect to answer that your app uses encryption, that it is standard and not provided by iOS, and, if your app is on the App Store in France, to upload a French encryption declaration. Apple's overview also mentions that some apps need to send the US government a year-end self-classification report. Check whether that applies to you.

To avoid answering on every upload, record your answer in the app's `Info.plist`:

- `ITSAppUsesNonExemptEncryption`. Apple says `NO` means no encryption, or only exempt forms of it. With the encryption build, work out your answer with Apple's guides rather than assuming `NO`.
- `ITSEncryptionExportComplianceCode`, if Apple gives you a code after reviewing documentation you uploaded.
- In Expo, `ITSAppUsesNonExemptEncryption` is `ios.config.usesNonExemptEncryption` in `app.json`. Add the compliance code through `ios.infoPlist`.

Google Play has no export-compliance questionnaire like Apple's, but export rules apply to you as the publisher however you distribute the app.

Where to read more:

- Apple: [Complying with encryption export regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations) (the `Info.plist` keys)
- Apple: [Export compliance documentation for encryption](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption) (the table above) and [Determine and upload app encryption documentation](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)
- US Bureau of Industry and Security: [Encryption](https://www.bis.gov/learn-support/encryption-controls)
