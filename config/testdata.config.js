'use strict';

const _data = {

  hyva_login: {
    standard_user: {
      email: 'test@example.com',
      password: 'password123',
    },
    invalid_user: {
      email: 'not-an-email@example.com',
      password: 'wrong_password',
    },
  },
};

const TestData = {
  get: (dotPath) => dotPath.split('.').reduce((obj, key) => obj?.[key], _data),
};

module.exports = { TestData };
