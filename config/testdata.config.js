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
  hyvaHome: {
    url: 'https://demo.hyva.io/',

    aimAnalogWatch: {
      price: '$45.00'
    },

    enduranceWatch: {
      price: '$49.00'
    },

    watchSubtotal: {
      aimPlusEndurance: '$94.00',
    },
  },
};

const TestData = {
  get: (dotPath) => dotPath.split('.').reduce((obj, key) => obj?.[key], _data),
};

module.exports = { TestData };
