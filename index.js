const jexl = require('jexl');

const context = {
  name: { first: 'Sterling', last: 'Archer' },
  assoc: [
    { first: 'Lana', last: 'Kane' },
    { first: 'Cyril', last: 'Figgis' },
    { first: 'Pam', last: 'Poovey' }
  ],
  age: 36
};

jexl.eval('assoc.first == "Lana"', context).then(function (res) {
  console.log(res) // Output: Kane
});
