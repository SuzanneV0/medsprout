'use strict';

/* =========================================================
   Medsprout — legal pages (Terms, Legal, Privacy, Cookies)
   Fill in LEGAL_INFO; anything still in [brackets] is shown
   highlighted on the page so it's easy to spot.
   ========================================================= */

const LEGAL_INFO = {
  owner: 'Medsprout',
  email: 'medsproutapp@gmail.com',
  jurisdiction: 'Ontario, Canada',
  updated: 'September 24, 2026',
};

const legalVal = v => (/^\[.*\]$/.test(v)
  ? `<span class="placeholder">${v}</span>`
  : v.includes('@') ? `<a href="mailto:${v}">${v}</a>` : v);

const LEGAL_PAGES = {
  /* ---------------------------------------------------- */
  terms: {
    title: 'Terms of Use',
    body: () => `
      <p>These Terms of Use (“Terms”) apply to Medsprout (the “App”), available at medsprout.app and as an app installed from that website. By using the App, you agree to these Terms. If you don’t agree, please don’t use the App.</p>

      <h2>1. What Medsprout is</h2>
      <p>Medsprout is a personal organization tool that helps you keep track of your medications, dose reminders, refills, taper schedules and side effects. It is <strong>not</strong> a medical device and does not provide medical advice, diagnosis or treatment.</p>

      <h2>2. Not medical advice</h2>
      <p>Always follow the instructions from your prescriber, your pharmacist and your prescription label. Dose times, re-spaced doses after a late or missed dose, refill estimates and taper schedules are calculated only from the information you enter, and they may be wrong if that information is incomplete or incorrect. Check them with your healthcare provider.</p>
      <p>If you use <em>Scan a label</em>, the App reads the photo automatically and can misread names, doses, numbers or directions. Always compare every filled-in field with your label before saving.</p>
      <p><strong>Never start, stop, skip or change a medication or taper because of something the App shows you</strong> without first speaking to your healthcare provider. In a medical emergency, call 911 or your local emergency number.</p>

      <h2>3. Reminders may not always arrive</h2>
      <p>Reminders and alerts depend on your device, browser, operating system, notification settings, battery-saving features and whether the App is open or running in the background. They can be delayed or not delivered at all. Do not rely on the App as your only way of remembering to take a medication.</p>

      <h2>4. Your data and your responsibilities</h2>
      <ul>
        <li>Everything you enter is stored only on your own device. Medsprout does not receive, store or back up your information, and cannot recover it. See the <a href="#privacy">Privacy Policy</a>.</li>
        <li>Clearing your browser data, uninstalling the App or losing your device will delete your information. Use <em>Settings → Export backup</em> to keep your own copy.</li>
        <li>You are responsible for the accuracy of what you enter and for keeping your device secure (for example, with a screen lock).</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You may use the App for your own personal, non-commercial purposes, or to help someone in your care. You agree not to misuse the App, interfere with its operation or the website that hosts it, or use it for any unlawful purpose.</p>

      <h2>6. Intellectual property</h2>
      <p>The App, including its design, text, graphics and code, belongs to ${legalVal(LEGAL_INFO.owner)} and is protected by law. The fonts used in the App are licensed separately under their own open-source licences (see <a href="#legal">Legal</a>).</p>

      <h2>7. Changes and availability</h2>
      <p>We may update, change, suspend or discontinue the App at any time. We will try to give notice of significant changes, but the App is provided without any promise that it will always be available.</p>

      <h2>8. No warranty</h2>
      <p>The App is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including warranties of accuracy, reliability, fitness for a particular purpose and non-infringement, to the extent permitted by law.</p>

      <h2>9. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, ${legalVal(LEGAL_INFO.owner)} will not be liable for any loss or harm arising from your use of, or inability to use, the App, including missed, late or incorrect doses, reminders that were not delivered, incorrect calculations, or lost data. Nothing in these Terms limits any rights you have that cannot be limited by law.</p>

      <h2>10. Governing law</h2>
      <p>These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there, without regard to conflict-of-law rules. Any dispute will be handled by the courts of Ontario, unless the law where you live gives you the right to bring it elsewhere.</p>

      <h2>11. Changes to these Terms</h2>
      <p>We may update these Terms from time to time. The “Last updated” date above shows when they last changed. Continuing to use the App after a change means you accept the updated Terms.</p>

      <h2>12. Contact</h2>
      <p>Questions about these Terms: ${legalVal(LEGAL_INFO.email)}.</p>`,
  },

  /* ---------------------------------------------------- */
  legal: {
    title: 'Legal',
    body: () => `
      <h2>Who runs Medsprout</h2>
      <p>Medsprout is an independent project based in ${legalVal(LEGAL_INFO.jurisdiction)}.<br>Contact: ${legalVal(LEGAL_INFO.email)}</p>

      <h2>Medical disclaimer</h2>
      <p>Medsprout is a reminder and record-keeping tool. It is not a medical device, and nothing in it is medical advice. It does not replace your doctor, pharmacist or other healthcare provider.</p>
      <ul>
        <li>Always follow your prescription label and your healthcare provider’s instructions.</li>
        <li>Suggestions in the App, such as re-spaced dose times after a late dose or a note about skipping a missed dose, are general guidance only. Check with your pharmacist or prescriber.</li>
        <li>Taper schedules are built only from the numbers you enter. Only change or stop a medication under the supervision of your prescriber.</li>
        <li>If you have a severe reaction, such as trouble breathing or swelling of the face, lips or throat, call 911 or your local emergency number right away.</li>
      </ul>

      <h2>No affiliation</h2>
      <p>Medsprout is independent. It is not affiliated with, endorsed by or sponsored by any pharmaceutical company, pharmacy, healthcare provider or insurer. Medication names you enter may be trademarks of their respective owners.</p>

      <h2>Third-party services and licences</h2>
      <ul>
        <li><strong>Hosting and anonymous visit counts:</strong> Vercel Inc. (Vercel Web Analytics)</li>
        <li><strong>Fonts:</strong> Cal Sans and Questrial, both licensed under the SIL Open Font License 1.1, hosted with the App.</li>
        <li><strong>Label scanning:</strong> Tesseract.js (Apache License 2.0) and its English language data package (MIT License), hosted with the App. It runs entirely on your device.</li>
      </ul>`,
  },

  /* ---------------------------------------------------- */
  privacy: {
    title: 'Privacy Policy',
    body: () => `
      <div class="notice"><strong>In short:</strong> Medsprout does not collect, receive or store your health information. Everything you enter stays in your browser, on your device. There are no accounts and no advertising. We only count visits anonymously, without tracking cookies, to know roughly how many people use the App and in which countries.</div>

      <h2>1. Who we are</h2>
      <p>Medsprout is operated by ${legalVal(LEGAL_INFO.owner)} (“we”, “us”). Contact: ${legalVal(LEGAL_INFO.email)}.</p>

      <h2>2. Information you enter stays on your device</h2>
      <p>The information you add to Medsprout, including the names of any family members you add, medication names, strengths, label instructions, dose schedules, dose history, pill counts, refills, taper schedules, side-effect notes and your settings, is saved in your browser’s local storage on the device you are using.</p>
      <p>This information is <strong>never sent to us</strong>. Medsprout has no user accounts, no database and no server that receives your information, so we cannot see, access, share, sell, recover or delete it for you.</p>

      <p>If you track medications for family members or others in your care, their information is stored the same way, only on your device. Please make sure they, or their legal guardian, are comfortable with you keeping it.</p>

      <h2>3. What does leave your device</h2>
      <p>Like any website, a few technical things happen when the App loads:</p>
      <ul>
        <li><strong>Website hosting (Vercel).</strong> Your browser downloads the App’s files from our hosting provider, Vercel Inc. As with any website, Vercel may automatically process technical information such as your IP address, browser type and the time of the request, for example in server logs used for security and delivery. This does not include anything you enter into the App. See <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel’s privacy policy</a>.</li>
        <li><strong>Anonymous visit counts (Vercel Web Analytics).</strong> When you open the App, an anonymous page view is recorded, including the page address, the referring website, your browser, operating system and device type, and your approximate location at country level, derived from your connection. It does not use third-party cookies. Instead, visits are counted with an anonymous code generated from the request, which is discarded after 24 hours. The data isn’t tied to your IP address, and it can’t identify you or follow you across other websites. It never includes anything you enter into the App. We use these totals only to understand how many people use Medsprout and roughly where. See <a href="https://vercel.com/docs/analytics/privacy-policy" target="_blank" rel="noopener">Vercel’s analytics privacy notice</a>.</li>
        <li><strong>Label reader download, only if you scan a label.</strong> The first time you use <em>Scan a label</em>, your browser downloads the text-recognition engine (Tesseract.js) and its English language file from Medsprout’s own hosting (Vercel), like the rest of the App. <strong>Your photo is never sent anywhere:</strong> it is read on your device and isn’t saved, not even on your device. Only the text that fills in the form is kept, once you save the medication.</li>
      </ul>
      <p>We do not use this technical information to identify you, and we do not combine it with anything else.</p>

      <h2>4. Notifications</h2>
      <p>If you turn on reminders, your device creates and shows the notifications itself. We don’t use a push-notification server, and no reminder content is sent to us.</p>

      <h2>5. Backups you export</h2>
      <p>If you use <em>Settings → Export backup</em>, a file containing your information is saved wherever you choose. You control that file. It contains sensitive health information, so store and share it carefully.</p>
      <p>You can protect a backup with a password (recommended). The file is then encrypted on your device with AES-256, and it can only be opened with that password. Medsprout never sees or stores your password, so a forgotten password can’t be recovered. A backup exported without a password is readable by anyone who has the file.</p>

      <h2>6. What we don’t do</h2>
      <ul>
        <li>No accounts or sign-in</li>
        <li>No advertising, tracking pixels or cross-site tracking. Our only analytics are the anonymous visit counts described above.</li>
        <li>No selling, renting or sharing of personal information</li>
        <li>No cookies (see the <a href="#cookies">Cookies Policy</a>)</li>
      </ul>

      <h2>7. Keeping your information safe</h2>
      <p>Because your information lives on your device, its security depends on your device. Anyone who can use your device and browser may be able to open the App and see your information. Use a screen lock, and avoid using Medsprout on shared or public devices.</p>

      <h2>8. How long information is kept and how to delete it</h2>
      <p>Your information stays on your device until you delete it. You can delete it at any time with <em>Settings → Erase all data</em>, by clearing this site’s data in your browser settings, or by uninstalling the App.</p>

      <h2>9. Your rights</h2>
      <p>You have full control over your information, and you can view, export, change or delete it directly in the App. Because we don’t hold any of it, we have nothing to provide or delete on request. If you have questions about your privacy rights, contact us at ${legalVal(LEGAL_INFO.email)}.</p>

      <h2>10. Children</h2>
      <p>Medsprout is not directed at children under 13. A parent or guardian may use it to manage medications for a child in their care.</p>

      <h2>11. Changes to this policy</h2>
      <p>We may update this policy from time to time. The “Last updated” date above shows when it last changed.</p>

      <h2>12. Contact</h2>
      <p>Questions about privacy: ${legalVal(LEGAL_INFO.email)}.</p>`,
  },

  /* ---------------------------------------------------- */
  cookies: {
    title: 'Cookies Policy',
    body: () => `
      <div class="notice"><strong>In short:</strong> Medsprout does not use cookies. There are no tracking, analytics or advertising cookies.</div>

      <h2>1. What cookies are</h2>
      <p>Cookies are small text files that websites place in your browser, often to remember you or to track you across sites. Medsprout does not set any.</p>

      <h2>2. What Medsprout uses instead</h2>
      <p>To work, the App uses a few standard browser features that store information only on your device. They are strictly necessary for the App to function and are never used for tracking.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Technology</th><th>What it’s for</th><th>How long it’s kept</th></tr></thead>
        <tbody>
          <tr><td>Local storage<br><small>medsprout:v1</small></td><td>Saves your medications, schedules, dose history, side-effect notes and settings.</td><td>Until you erase it</td></tr>
          <tr><td>Service worker &amp; cache storage</td><td>Lets the App open and work offline, and shows reminder notifications.</td><td>Until you clear site data or uninstall</td></tr>
          <tr><td>IndexedDB<br><small>keyval-store</small></td><td>Only if you scan a label: keeps a copy of the label reader’s English language file so later scans are faster. It contains no personal information and never includes your photos.</td><td>Until you clear site data</td></tr>
          <tr><td>Notification permission</td><td>Remembers whether you allowed reminders. Your browser stores this setting.</td><td>Until you change it in your browser</td></tr>
        </tbody>
      </table></div>

      <h2>3. Third parties</h2>
      <p>The App, its fonts and its label reader are all served by our hosting provider, Vercel, which also counts visits anonymously with Vercel Web Analytics (it does not use third-party cookies). No other third-party services are used. Medsprout does not ask Vercel to set cookies. Vercel’s handling of technical request information is described in <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel’s privacy policy</a>.</p>

      <h2>4. Managing or clearing this storage</h2>
      <p>You can delete everything Medsprout stores with <em>Settings → Erase all data</em>, or by clearing this site’s data in your browser settings. Doing so permanently deletes your medications and history from this device, so export a backup first if you want to keep them.</p>

      <h2>5. Changes to this policy</h2>
      <p>If we ever start using cookies, we’ll update this policy and ask for your consent where required.</p>

      <h2>6. Contact</h2>
      <p>Questions: ${legalVal(LEGAL_INFO.email)}.</p>`,
  },
};
