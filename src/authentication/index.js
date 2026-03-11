/**
 * Authentication module exports
 * Handles user authentication, session management, and security validation
 */

const AuthBootstrap = require('./authBootstrap');
const ensureAuth = require('./ensureAuth');

module.exports = {
  AuthBootstrap,
  ensureAuth
};