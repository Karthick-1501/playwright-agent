'use strict';

const _data = {
  login: {
    standard_user: {
      username: 'standard_user',
      password: 'secret_sauce',
    },
    locked_out_user: {
      username: 'locked_out_user',
      password: 'secret_sauce',
    },
    invalid_user: {
      username: 'invalid_user',
      password: 'wrong_password',
    },
  },
  hyva_login: {
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
