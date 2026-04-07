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
  },
};

const TestData = {
  get: (path) => path.split('.').reduce((obj, key) => obj?.[key], _data),
};

module.exports = { TestData };
