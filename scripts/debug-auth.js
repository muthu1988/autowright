require('dotenv').config();
const AuthBootstrap = require('../src/authBootstrap');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    console.log('🔐 Testing Authentication Only...');
    
    // Load existing analysis results
    const analysisPath = path.join('output', 'analysis-output.json');
    const analysisResults = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
    
    console.log('✅ Analysis loaded:', analysisResults.pageType);
    
    // Use saved auth selectors if available, otherwise use defaults
    let authSelectors;
    if (analysisResults.authSelectors) {
      authSelectors = analysisResults.authSelectors;
      console.log('✅ Using saved auth selectors from analysis');
    } else {
      authSelectors = {
        usernameSelector: '#username',
        passwordSelector: '#password', 
        submitSelector: "[data-testid='Submit']"
      };
      console.log('⚠️ Using default auth selectors (no saved selectors found)');
    }
    
    console.log('🎯 Auth Selectors:', JSON.stringify(authSelectors, null, 2));
    
    // Test credentials
    console.log('🔑 Credentials:');
    console.log('- Base URL:', process.env.BASE_URL);
    console.log('- Username:', process.env.LOGIN_USERNAME);
    console.log('- Password Length:', process.env.PASSWORD?.length || 0);
    
    // Create auth instance
    const auth = new AuthBootstrap({
      baseUrl: process.env.BASE_URL,
      loginUrl: process.env.LOGIN_URL,
      username: process.env.LOGIN_USERNAME,
      password: process.env.PASSWORD,
      usernameSelector: authSelectors.usernameSelector,
      passwordSelector: authSelectors.passwordSelector,
      submitSelector: authSelectors.submitSelector,
      successUrlContains: process.env.SUCCESS_URL_CONTAINS,
    });

    console.log('\n🚀 Starting login test...');
    await auth.login();
    console.log('✅ Authentication successful!');

  } catch (err) {
    console.error('❌ Authentication failed:', err.message);
    process.exit(1);
  }
})();
