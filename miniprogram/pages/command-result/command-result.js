const authService = require('../../services/auth-service');

Page({ onLoad() { authService.requireLogin(); } });
