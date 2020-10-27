(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = global || self, global.Jexl = factory());
}(this, (function () { 'use strict';

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */

  /**
   * Evaluates an ArrayLiteral by returning its value, with each element
   * independently run through the evaluator.
   * @param {{type: 'ObjectLiteral', value: <{}>}} ast An expression tree with an
   *      ObjectLiteral as the top node
   * @returns {Promise.<[]>} resolves to a map contained evaluated values.
   * @private
   */
  var ArrayLiteral = function(ast) {
    return this.evalArray(ast.value)
  };

  /**
   * Evaluates a BinaryExpression node by running the Grammar's evaluator for
   * the given operator.
   * @param {{type: 'BinaryExpression', operator: <string>, left: {},
   *      right: {}}} ast An expression tree with a BinaryExpression as the top
   *      node
   * @returns {Promise<*>} resolves with the value of the BinaryExpression.
   * @private
   */
  var BinaryExpression = function(ast) {
    return this.Promise.all([this.eval(ast.left), this.eval(ast.right)]).then(
      arr => this._grammar[ast.operator].eval(arr[0], arr[1])
    )
  };

  /**
   * Evaluates a ConditionalExpression node by first evaluating its test branch,
   * and resolving with the consequent branch if the test is truthy, or the
   * alternate branch if it is not. If there is no consequent branch, the test
   * result will be used instead.
   * @param {{type: 'ConditionalExpression', test: {}, consequent: {},
   *      alternate: {}}} ast An expression tree with a ConditionalExpression as
   *      the top node
   * @private
   */
  var ConditionalExpression = function(ast) {
    return this.eval(ast.test).then(res => {
      if (res) {
        if (ast.consequent) {
          return this.eval(ast.consequent)
        }
        return res
      }
      return this.eval(ast.alternate)
    })
  };

  /**
   * Evaluates a FilterExpression by applying it to the subject value.
   * @param {{type: 'FilterExpression', relative: <boolean>, expr: {},
   *      subject: {}}} ast An expression tree with a FilterExpression as the top
   *      node
   * @returns {Promise<*>} resolves with the value of the FilterExpression.
   * @private
   */
  var FilterExpression = function(ast) {
    return this.eval(ast.subject).then(subject => {
      if (ast.relative) {
        return this._filterRelative(subject, ast.expr)
      }
      return this._filterStatic(subject, ast.expr)
    })
  };

  /**
   * Evaluates an Identifier by either stemming from the evaluated 'from'
   * expression tree or accessing the context provided when this Evaluator was
   * constructed.
   * @param {{type: 'Identifier', value: <string>, [from]: {}}} ast An expression
   *      tree with an Identifier as the top node
   * @returns {Promise<*>|*} either the identifier's value, or a Promise that
   *      will resolve with the identifier's value.
   * @private
   */
  var Identifier = function(ast) {
    if (!ast.from) {
      return ast.relative ? this._relContext[ast.value] : this._context[ast.value]
    }
    return this.eval(ast.from).then(context => {
      if (context === undefined || context === null) {
        return undefined
      }
      if (Array.isArray(context)) {
        context = context[0];
      }
      return context[ast.value]
    })
  };

  /**
   * Evaluates a Literal by returning its value property.
   * @param {{type: 'Literal', value: <string|number|boolean>}} ast An expression
   *      tree with a Literal as its only node
   * @returns {string|number|boolean} The value of the Literal node
   * @private
   */
  var Literal = function(ast) {
    return ast.value
  };

  /**
   * Evaluates an ObjectLiteral by returning its value, with each key
   * independently run through the evaluator.
   * @param {{type: 'ObjectLiteral', value: <{}>}} ast An expression tree with an
   *      ObjectLiteral as the top node
   * @returns {Promise<{}>} resolves to a map contained evaluated values.
   * @private
   */
  var ObjectLiteral = function(ast) {
    return this.evalMap(ast.value)
  };

  /**
   * Evaluates a Transform node by applying a function from the transforms map
   * to the subject value.
   * @param {{type: 'Transform', name: <string>, subject: {}}} ast An
   *      expression tree with a Transform as the top node
   * @returns {Promise<*>|*} the value of the transformation, or a Promise that
   *      will resolve with the transformed value.
   * @private
   */
  var Transform = function(ast) {
    const transform = this._transforms[ast.name];
    if (!transform) {
      throw new Error(`Transform ${ast.name} is not defined.`)
    }
    return this.Promise.all([
      this.eval(ast.subject),
      this.evalArray(ast.args || [])
    ]).then(arr => transform.apply(null, [arr[0]].concat(arr[1])))
  };

  /**
   * Evaluates a Unary expression by passing the right side through the
   * operator's eval function.
   * @param {{type: 'UnaryExpression', operator: <string>, right: {}}} ast An
   *      expression tree with a UnaryExpression as the top node
   * @returns {Promise<*>} resolves with the value of the UnaryExpression.
   * @constructor
   */
  var UnaryExpression = function(ast) {
    return this.eval(ast.right).then(right =>
      this._grammar[ast.operator].eval(right)
    )
  };

  var handlers = {
  	ArrayLiteral: ArrayLiteral,
  	BinaryExpression: BinaryExpression,
  	ConditionalExpression: ConditionalExpression,
  	FilterExpression: FilterExpression,
  	Identifier: Identifier,
  	Literal: Literal,
  	ObjectLiteral: ObjectLiteral,
  	Transform: Transform,
  	UnaryExpression: UnaryExpression
  };

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */



  /**
   * The Evaluator takes a Jexl expression tree as generated by the
   * {@link Parser} and calculates its value within a given context. The
   * collection of transforms, context, and a relative context to be used as the
   * root for relative identifiers, are all specific to an Evaluator instance.
   * When any of these things change, a new instance is required.  However, a
   * single instance can be used to simultaneously evaluate many different
   * expressions, and does not have to be reinstantiated for each.
   * @param {{}} grammar A grammar map against which to evaluate the expression
   *      tree
   * @param {{}} [transforms] A map of transform names to transform functions. A
   *      transform function takes two arguments:
   *          - {*} val: A value to be transformed
   *          - {{}} args: A map of argument keys to their evaluated values, as
   *              specified in the expression string
   *      The transform function should return either the transformed value, or
   *      a Promises/A+ Promise object that resolves with the value and rejects
   *      or throws only when an unrecoverable error occurs. Transforms should
   *      generally return undefined when they don't make sense to be used on the
   *      given value type, rather than throw/reject. An error is only
   *      appropriate when the transform would normally return a value, but
   *      cannot due to some other failure.
   * @param {{}} [context] A map of variable keys to their values. This will be
   *      accessed to resolve the value of each non-relative identifier. Any
   *      Promise values will be passed to the expression as their resolved
   *      value.
   * @param {{}|Array<{}|Array>} [relativeContext] A map or array to be accessed
   *      to resolve the value of a relative identifier.
   * @param {function} promise A constructor for the Promise class to be used;
   *      probably either Promise or PromiseSync.
   */
  class Evaluator {
    constructor(
      grammar,
      transforms,
      context,
      relativeContext,
      promise = Promise
    ) {
      this._grammar = grammar;
      this._transforms = transforms || {};
      this._context = context || {};
      this._relContext = relativeContext || this._context;
      this.Promise = promise;
    }

    /**
     * Evaluates an expression tree within the configured context.
     * @param {{}} ast An expression tree object
     * @returns {Promise<*>} resolves with the resulting value of the expression.
     */
    eval(ast) {
      return this.Promise.resolve().then(() => {
        return handlers[ast.type].call(this, ast)
      })
    }

    /**
     * Simultaneously evaluates each expression within an array, and delivers the
     * response as an array with the resulting values at the same indexes as their
     * originating expressions.
     * @param {Array<string>} arr An array of expression strings to be evaluated
     * @returns {Promise<Array<{}>>} resolves with the result array
     */
    evalArray(arr) {
      return this.Promise.all(arr.map(elem => this.eval(elem)))
    }

    /**
     * Simultaneously evaluates each expression within a map, and delivers the
     * response as a map with the same keys, but with the evaluated result for each
     * as their value.
     * @param {{}} map A map of expression names to expression trees to be
     *      evaluated
     * @returns {Promise<{}>} resolves with the result map.
     */
    evalMap(map) {
      const keys = Object.keys(map);
      const result = {};
      const asts = keys.map(key => {
        return this.eval(map[key])
      });
      return this.Promise.all(asts).then(vals => {
        vals.forEach((val, idx) => {
          result[keys[idx]] = val;
        });
        return result
      })
    }

    /**
     * Applies a filter expression with relative identifier elements to a subject.
     * The intent is for the subject to be an array of subjects that will be
     * individually used as the relative context against the provided expression
     * tree. Only the elements whose expressions result in a truthy value will be
     * included in the resulting array.
     *
     * If the subject is not an array of values, it will be converted to a single-
     * element array before running the filter.
     * @param {*} subject The value to be filtered usually an array. If this value is
     *      not an array, it will be converted to an array with this value as the
     *      only element.
     * @param {{}} expr The expression tree to run against each subject. If the
     *      tree evaluates to a truthy result, then the value will be included in
     *      the returned array otherwise, it will be eliminated.
     * @returns {Promise<Array>} resolves with an array of values that passed the
     *      expression filter.
     * @private
     */
    _filterRelative(subject, expr) {
      const promises = [];
      if (!Array.isArray(subject)) {
        subject = subject === undefined ? [] : [subject];
      }
      subject.forEach(elem => {
        const evalInst = new Evaluator(
          this._grammar,
          this._transforms,
          this._context,
          elem,
          this.Promise
        );
        promises.push(evalInst.eval(expr));
      });
      return this.Promise.all(promises).then(values => {
        const results = [];
        values.forEach((value, idx) => {
          if (value) {
            results.push(subject[idx]);
          }
        });
        return results
      })
    }

    /**
     * Applies a static filter expression to a subject value.  If the filter
     * expression evaluates to boolean true, the subject is returned if false,
     * undefined.
     *
     * For any other resulting value of the expression, this function will attempt
     * to respond with the property at that name or index of the subject.
     * @param {*} subject The value to be filtered.  Usually an Array (for which
     *      the expression would generally resolve to a numeric index) or an
     *      Object (for which the expression would generally resolve to a string
     *      indicating a property name)
     * @param {{}} expr The expression tree to run against the subject
     * @returns {Promise<*>} resolves with the value of the drill-down.
     * @private
     */
    _filterStatic(subject, expr) {
      return this.eval(expr).then(res => {
        if (typeof res === 'boolean') {
          return res ? subject : undefined
        }
        return subject[res]
      })
    }
  }

  var Evaluator_1 = Evaluator;

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */

  const numericRegex = /^-?(?:(?:[0-9]*\.[0-9]+)|[0-9]+)$/;
  const identRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  const escEscRegex = /\\\\/;
  const whitespaceRegex = /^\s*$/;
  const preOpRegexElems = [
    // Strings
    "'(?:(?:\\\\')|[^'])*'",
    '"(?:(?:\\\\")|[^"])*"',
    // Whitespace
    '\\s+',
    // Booleans
    '\\btrue\\b',
    '\\bfalse\\b'
  ];
  const postOpRegexElems = [
    // Identifiers
    '[a-zA-Z_\\$][a-zA-Z0-9_\\$]*',
    // Numerics (without negative symbol)
    '(?:(?:[0-9]*\\.[0-9]+)|[0-9]+)'
  ];
  const minusNegatesAfter = [
    'binaryOp',
    'unaryOp',
    'openParen',
    'openBracket',
    'question',
    'colon'
  ];

  /**
   * Lexer is a collection of stateless, statically-accessed functions for the
   * lexical parsing of a Jexl string.  Its responsibility is to identify the
   * "parts of speech" of a Jexl expression, and tokenize and label each, but
   * to do only the most minimal syntax checking; the only errors the Lexer
   * should be concerned with are if it's unable to identify the utility of
   * any of its tokens.  Errors stemming from these tokens not being in a
   * sensible configuration should be left for the Parser to handle.
   * @type {{}}
   */
  class Lexer {
    constructor(grammar) {
      this._grammar = grammar;
    }

    /**
     * Splits a Jexl expression string into an array of expression elements.
     * @param {string} str A Jexl expression string
     * @returns {Array<string>} An array of substrings defining the functional
     *      elements of the expression.
     */
    getElements(str) {
      const regex = this._getSplitRegex();
      return str.split(regex).filter(elem => {
        // Remove empty strings
        return elem
      })
    }

    /**
     * Converts an array of expression elements into an array of tokens.  Note that
     * the resulting array may not equal the element array in length, as any
     * elements that consist only of whitespace get appended to the previous
     * token's "raw" property.  For the structure of a token object, please see
     * {@link Lexer#tokenize}.
     * @param {Array<string>} elements An array of Jexl expression elements to be
     *      converted to tokens
     * @returns {Array<{type, value, raw}>} an array of token objects.
     */
    getTokens(elements) {
      const tokens = [];
      let negate = false;
      for (let i = 0; i < elements.length; i++) {
        if (this._isWhitespace(elements[i])) {
          if (tokens.length) {
            tokens[tokens.length - 1].raw += elements[i];
          }
        } else if (elements[i] === '-' && this._isNegative(tokens)) {
          negate = true;
        } else {
          if (negate) {
            elements[i] = '-' + elements[i];
            negate = false;
          }
          tokens.push(this._createToken(elements[i]));
        }
      }
      // Catch a - at the end of the string. Let the parser handle that issue.
      if (negate) {
        tokens.push(this._createToken('-'));
      }
      return tokens
    }

    /**
     * Converts a Jexl string into an array of tokens.  Each token is an object
     * in the following format:
     *
     *     {
     *         type: <string>,
     *         [name]: <string>,
     *         value: <boolean|number|string>,
     *         raw: <string>
     *     }
     *
     * Type is one of the following:
     *
     *      literal, identifier, binaryOp, unaryOp
     *
     * OR, if the token is a control character its type is the name of the element
     * defined in the Grammar.
     *
     * Name appears only if the token is a control string found in
     * {@link grammar#elements}, and is set to the name of the element.
     *
     * Value is the value of the token in the correct type (boolean or numeric as
     * appropriate). Raw is the string representation of this value taken directly
     * from the expression string, including any trailing spaces.
     * @param {string} str The Jexl string to be tokenized
     * @returns {Array<{type, value, raw}>} an array of token objects.
     * @throws {Error} if the provided string contains an invalid token.
     */
    tokenize(str) {
      const elements = this.getElements(str);
      return this.getTokens(elements)
    }

    /**
     * Creates a new token object from an element of a Jexl string. See
     * {@link Lexer#tokenize} for a description of the token object.
     * @param {string} element The element from which a token should be made
     * @returns {{value: number|boolean|string, [name]: string, type: string,
     *      raw: string}} a token object describing the provided element.
     * @throws {Error} if the provided string is not a valid expression element.
     * @private
     */
    _createToken(element) {
      const token = {
        type: 'literal',
        value: element,
        raw: element
      };
      if (element[0] === '"' || element[0] === "'") {
        token.value = this._unquote(element);
      } else if (element.match(numericRegex)) {
        token.value = parseFloat(element);
      } else if (element === 'true' || element === 'false') {
        token.value = element === 'true';
      } else if (this._grammar[element]) {
        token.type = this._grammar[element].type;
      } else if (element.match(identRegex)) {
        token.type = 'identifier';
      } else {
        throw new Error(`Invalid expression token: ${element}`)
      }
      return token
    }

    /**
     * Escapes a string so that it can be treated as a string literal within a
     * regular expression.
     * @param {string} str The string to be escaped
     * @returns {string} the RegExp-escaped string.
     * @see https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
     * @private
     */
    _escapeRegExp(str) {
      str = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (str.match(identRegex)) {
        str = '\\b' + str + '\\b';
      }
      return str
    }

    /**
     * Gets a RegEx object appropriate for splitting a Jexl string into its core
     * elements.
     * @returns {RegExp} An element-splitting RegExp object
     * @private
     */
    _getSplitRegex() {
      if (!this._splitRegex) {
        // Sort by most characters to least, then regex escape each
        const elemArray = Object.keys(this._grammar)
          .sort((a, b) => {
            return b.length - a.length
          })
          .map(elem => {
            return this._escapeRegExp(elem)
          }, this);
        this._splitRegex = new RegExp(
          '(' +
            [
              preOpRegexElems.join('|'),
              elemArray.join('|'),
              postOpRegexElems.join('|')
            ].join('|') +
            ')'
        );
      }
      return this._splitRegex
    }

    /**
     * Determines whether the addition of a '-' token should be interpreted as a
     * negative symbol for an upcoming number, given an array of tokens already
     * processed.
     * @param {Array<Object>} tokens An array of tokens already processed
     * @returns {boolean} true if adding a '-' should be considered a negative
     *      symbol; false otherwise
     * @private
     */
    _isNegative(tokens) {
      if (!tokens.length) return true
      return minusNegatesAfter.some(
        type => type === tokens[tokens.length - 1].type
      )
    }

    /**
     * A utility function to determine if a string consists of only space
     * characters.
     * @param {string} str A string to be tested
     * @returns {boolean} true if the string is empty or consists of only spaces;
     *      false otherwise.
     * @private
     */
    _isWhitespace(str) {
      return !!str.match(whitespaceRegex)
    }

    /**
     * Removes the beginning and trailing quotes from a string, unescapes any
     * escaped quotes on its interior, and unescapes any escaped escape
     * characters. Note that this function is not defensive; it assumes that the
     * provided string is not empty, and that its first and last characters are
     * actually quotes.
     * @param {string} str A string whose first and last characters are quotes
     * @returns {string} a string with the surrounding quotes stripped and escapes
     *      properly processed.
     * @private
     */
    _unquote(str) {
      const quote = str[0];
      const escQuoteRegex = new RegExp('\\\\' + quote, 'g');
      return str
        .substr(1, str.length - 2)
        .replace(escQuoteRegex, quote)
        .replace(escEscRegex, '\\')
    }
  }

  var Lexer_1 = Lexer;

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */

  /**
   * Handles a subexpression that's used to define a transform argument's value.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var argVal = function(ast) {
    this._cursor.args.push(ast);
  };

  /**
   * Handles new array literals by adding them as a new node in the AST,
   * initialized with an empty array.
   */
  var arrayStart = function() {
    this._placeAtCursor({
      type: 'ArrayLiteral',
      value: []
    });
  };

  /**
   * Handles a subexpression representing an element of an array literal.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var arrayVal = function(ast) {
    if (ast) {
      this._cursor.value.push(ast);
    }
  };

  /**
   * Handles tokens of type 'binaryOp', indicating an operation that has two
   * inputs: a left side and a right side.
   * @param {{type: <string>}} token A token object
   */
  var binaryOp = function(token) {
    const precedence = this._grammar[token.value].precedence || 0;
    let parent = this._cursor._parent;
    while (
      parent &&
      parent.operator &&
      this._grammar[parent.operator].precedence >= precedence
    ) {
      this._cursor = parent;
      parent = parent._parent;
    }
    const node = {
      type: 'BinaryExpression',
      operator: token.value,
      left: this._cursor
    };
    this._setParent(this._cursor, node);
    this._cursor = parent;
    this._placeAtCursor(node);
  };

  /**
   * Handles successive nodes in an identifier chain.  More specifically, it
   * sets values that determine how the following identifier gets placed in the
   * AST.
   */
  var dot = function() {
    this._nextIdentEncapsulate =
      this._cursor &&
      this._cursor.type !== 'UnaryExpression' &&
      (this._cursor.type !== 'BinaryExpression' ||
        (this._cursor.type === 'BinaryExpression' && this._cursor.right));
    this._nextIdentRelative =
      !this._cursor || (this._cursor && !this._nextIdentEncapsulate);
    if (this._nextIdentRelative) {
      this._relative = true;
    }
  };

  /**
   * Handles a subexpression used for filtering an array returned by an
   * identifier chain.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var filter = function(ast) {
    this._placeBeforeCursor({
      type: 'FilterExpression',
      expr: ast,
      relative: this._subParser.isRelative(),
      subject: this._cursor
    });
  };

  /**
   * Handles identifier tokens by adding them as a new node in the AST.
   * @param {{type: <string>}} token A token object
   */
  var identifier = function(token) {
    const node = {
      type: 'Identifier',
      value: token.value
    };
    if (this._nextIdentEncapsulate) {
      node.from = this._cursor;
      this._placeBeforeCursor(node);
      this._nextIdentEncapsulate = false;
    } else {
      if (this._nextIdentRelative) {
        node.relative = true;
        this._nextIdentRelative = false;
      }
      this._placeAtCursor(node);
    }
  };

  /**
   * Handles literal values, such as strings, booleans, and numerics, by adding
   * them as a new node in the AST.
   * @param {{type: <string>}} token A token object
   */
  var literal = function(token) {
    this._placeAtCursor({
      type: 'Literal',
      value: token.value
    });
  };

  /**
   * Queues a new object literal key to be written once a value is collected.
   * @param {{type: <string>}} token A token object
   */
  var objKey = function(token) {
    this._curObjKey = token.value;
  };

  /**
   * Handles new object literals by adding them as a new node in the AST,
   * initialized with an empty object.
   */
  var objStart = function() {
    this._placeAtCursor({
      type: 'ObjectLiteral',
      value: {}
    });
  };

  /**
   * Handles an object value by adding its AST to the queued key on the object
   * literal node currently at the cursor.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var objVal = function(ast) {
    this._cursor.value[this._curObjKey] = ast;
  };

  /**
   * Handles traditional subexpressions, delineated with the groupStart and
   * groupEnd elements.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var subExpression = function(ast) {
    this._placeAtCursor(ast);
  };

  /**
   * Handles a completed alternate subexpression of a ternary operator.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var ternaryEnd = function(ast) {
    this._cursor.alternate = ast;
  };

  /**
   * Handles a completed consequent subexpression of a ternary operator.
   * @param {{type: <string>}} ast The subexpression tree
   */
  var ternaryMid = function(ast) {
    this._cursor.consequent = ast;
  };

  /**
   * Handles the start of a new ternary expression by encapsulating the entire
   * AST in a ConditionalExpression node, and using the existing tree as the
   * test element.
   */
  var ternaryStart = function() {
    this._tree = {
      type: 'ConditionalExpression',
      test: this._tree
    };
    this._cursor = this._tree;
  };

  /**
   * Handles identifier tokens when used to indicate the name of a transform to
   * be applied.
   * @param {{type: <string>}} token A token object
   */
  var transform = function(token) {
    this._placeBeforeCursor({
      type: 'Transform',
      name: token.value,
      args: [],
      subject: this._cursor
    });
  };

  /**
   * Handles token of type 'unaryOp', indicating that the operation has only
   * one input: a right side.
   * @param {{type: <string>}} token A token object
   */
  var unaryOp = function(token) {
    this._placeAtCursor({
      type: 'UnaryExpression',
      operator: token.value
    });
  };

  var handlers$1 = {
  	argVal: argVal,
  	arrayStart: arrayStart,
  	arrayVal: arrayVal,
  	binaryOp: binaryOp,
  	dot: dot,
  	filter: filter,
  	identifier: identifier,
  	literal: literal,
  	objKey: objKey,
  	objStart: objStart,
  	objVal: objVal,
  	subExpression: subExpression,
  	ternaryEnd: ternaryEnd,
  	ternaryMid: ternaryMid,
  	ternaryStart: ternaryStart,
  	transform: transform,
  	unaryOp: unaryOp
  };

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */



  /**
   * A mapping of all states in the finite state machine to a set of instructions
   * for handling or transitioning into other states. Each state can be handled
   * in one of two schemes: a tokenType map, or a subHandler.
   *
   * Standard expression elements are handled through the tokenType object. This
   * is an object map of all legal token types to encounter in this state (and
   * any unexpected token types will generate a thrown error) to an options
   * object that defines how they're handled.  The available options are:
   *
   *      {string} toState: The name of the state to which to transition
   *          immediately after handling this token
   *      {string} handler: The handler function to call when this token type is
   *          encountered in this state.  If omitted, the default handler
   *          matching the token's "type" property will be called. If the handler
   *          function does not exist, no call will be made and no error will be
   *          generated.  This is useful for tokens whose sole purpose is to
   *          transition to other states.
   *
   * States that consume a subexpression should define a subHandler, the
   * function to be called with an expression tree argument when the
   * subexpression is complete. Completeness is determined through the
   * endStates object, which maps tokens on which an expression should end to the
   * state to which to transition once the subHandler function has been called.
   *
   * Additionally, any state in which it is legal to mark the AST as completed
   * should have a 'completable' property set to boolean true.  Attempting to
   * call {@link Parser#complete} in any state without this property will result
   * in a thrown Error.
   *
   * @type {{}}
   */
  var states_1 = {
    expectOperand: {
      tokenTypes: {
        literal: { toState: 'expectBinOp' },
        identifier: { toState: 'identifier' },
        unaryOp: {},
        openParen: { toState: 'subExpression' },
        openCurl: { toState: 'expectObjKey', handler: handlers$1.objStart },
        dot: { toState: 'traverse' },
        openBracket: { toState: 'arrayVal', handler: handlers$1.arrayStart }
      }
    },
    expectBinOp: {
      tokenTypes: {
        binaryOp: { toState: 'expectOperand' },
        pipe: { toState: 'expectTransform' },
        dot: { toState: 'traverse' },
        question: { toState: 'ternaryMid', handler: handlers$1.ternaryStart }
      },
      completable: true
    },
    expectTransform: {
      tokenTypes: {
        identifier: { toState: 'postTransform', handler: handlers$1.transform }
      }
    },
    expectObjKey: {
      tokenTypes: {
        identifier: { toState: 'expectKeyValSep', handler: handlers$1.objKey },
        closeCurl: { toState: 'expectBinOp' }
      }
    },
    expectKeyValSep: {
      tokenTypes: {
        colon: { toState: 'objVal' }
      }
    },
    postTransform: {
      tokenTypes: {
        openParen: { toState: 'argVal' },
        binaryOp: { toState: 'expectOperand' },
        dot: { toState: 'traverse' },
        openBracket: { toState: 'filter' },
        pipe: { toState: 'expectTransform' }
      },
      completable: true
    },
    postTransformArgs: {
      tokenTypes: {
        binaryOp: { toState: 'expectOperand' },
        dot: { toState: 'traverse' },
        openBracket: { toState: 'filter' },
        pipe: { toState: 'expectTransform' }
      },
      completable: true
    },
    identifier: {
      tokenTypes: {
        binaryOp: { toState: 'expectOperand' },
        dot: { toState: 'traverse' },
        openBracket: { toState: 'filter' },
        pipe: { toState: 'expectTransform' },
        question: { toState: 'ternaryMid', handler: handlers$1.ternaryStart }
      },
      completable: true
    },
    traverse: {
      tokenTypes: {
        identifier: { toState: 'identifier' }
      }
    },
    filter: {
      subHandler: handlers$1.filter,
      endStates: {
        closeBracket: 'identifier'
      }
    },
    subExpression: {
      subHandler: handlers$1.subExpression,
      endStates: {
        closeParen: 'expectBinOp'
      }
    },
    argVal: {
      subHandler: handlers$1.argVal,
      endStates: {
        comma: 'argVal',
        closeParen: 'postTransformArgs'
      }
    },
    objVal: {
      subHandler: handlers$1.objVal,
      endStates: {
        comma: 'expectObjKey',
        closeCurl: 'expectBinOp'
      }
    },
    arrayVal: {
      subHandler: handlers$1.arrayVal,
      endStates: {
        comma: 'arrayVal',
        closeBracket: 'expectBinOp'
      }
    },
    ternaryMid: {
      subHandler: handlers$1.ternaryMid,
      endStates: {
        colon: 'ternaryEnd'
      }
    },
    ternaryEnd: {
      subHandler: handlers$1.ternaryEnd,
      completable: true
    }
  };

  var states = {
  	states: states_1
  };

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */


  const states$1 = states.states;

  /**
   * The Parser is a state machine that converts tokens from the {@link Lexer}
   * into an Abstract Syntax Tree (AST), capable of being evaluated in any
   * context by the {@link Evaluator}.  The Parser expects that all tokens
   * provided to it are legal and typed properly according to the grammar, but
   * accepts that the tokens may still be in an invalid order or in some other
   * unparsable configuration that requires it to throw an Error.
   * @param {{}} grammar The grammar map to use to parse Jexl strings
   * @param {string} [prefix] A string prefix to prepend to the expression string
   *      for error messaging purposes.  This is useful for when a new Parser is
   *      instantiated to parse an subexpression, as the parent Parser's
   *      expression string thus far can be passed for a more user-friendly
   *      error message.
   * @param {{}} [stopMap] A mapping of token types to any truthy value. When the
   *      token type is encountered, the parser will return the mapped value
   *      instead of boolean false.
   */
  class Parser {
    constructor(grammar, prefix, stopMap) {
      this._grammar = grammar;
      this._state = 'expectOperand';
      this._tree = null;
      this._exprStr = prefix || '';
      this._relative = false;
      this._stopMap = stopMap || {};
    }

    /**
     * Processes a new token into the AST and manages the transitions of the state
     * machine.
     * @param {{type: <string>}} token A token object, as provided by the
     *      {@link Lexer#tokenize} function.
     * @throws {Error} if a token is added when the Parser has been marked as
     *      complete by {@link #complete}, or if an unexpected token type is added.
     * @returns {boolean|*} the stopState value if this parser encountered a token
     *      in the stopState mapb false if tokens can continue.
     */
    addToken(token) {
      if (this._state === 'complete') {
        throw new Error('Cannot add a new token to a completed Parser')
      }
      const state = states$1[this._state];
      const startExpr = this._exprStr;
      this._exprStr += token.raw;
      if (state.subHandler) {
        if (!this._subParser) {
          this._startSubExpression(startExpr);
        }
        const stopState = this._subParser.addToken(token);
        if (stopState) {
          this._endSubExpression();
          if (this._parentStop) return stopState
          this._state = stopState;
        }
      } else if (state.tokenTypes[token.type]) {
        const typeOpts = state.tokenTypes[token.type];
        let handleFunc = handlers$1[token.type];
        if (typeOpts.handler) {
          handleFunc = typeOpts.handler;
        }
        if (handleFunc) {
          handleFunc.call(this, token);
        }
        if (typeOpts.toState) {
          this._state = typeOpts.toState;
        }
      } else if (this._stopMap[token.type]) {
        return this._stopMap[token.type]
      } else {
        throw new Error(
          `Token ${token.raw} (${token.type}) unexpected in expression: ${this._exprStr}`
        )
      }
      return false
    }

    /**
     * Processes an array of tokens iteratively through the {@link #addToken}
     * function.
     * @param {Array<{type: <string>}>} tokens An array of tokens, as provided by
     *      the {@link Lexer#tokenize} function.
     */
    addTokens(tokens) {
      tokens.forEach(this.addToken, this);
    }

    /**
     * Marks this Parser instance as completed and retrieves the full AST.
     * @returns {{}|null} a full expression tree, ready for evaluation by the
     *      {@link Evaluator#eval} function, or null if no tokens were passed to
     *      the parser before complete was called
     * @throws {Error} if the parser is not in a state where it's legal to end
     *      the expression, indicating that the expression is incomplete
     */
    complete() {
      if (this._cursor && !states$1[this._state].completable) {
        throw new Error(`Unexpected end of expression: ${this._exprStr}`)
      }
      if (this._subParser) {
        this._endSubExpression();
      }
      this._state = 'complete';
      return this._cursor ? this._tree : null
    }

    /**
     * Indicates whether the expression tree contains a relative path identifier.
     * @returns {boolean} true if a relative identifier exists false otherwise.
     */
    isRelative() {
      return this._relative
    }

    /**
     * Ends a subexpression by completing the subParser and passing its result
     * to the subHandler configured in the current state.
     * @private
     */
    _endSubExpression() {
      states$1[this._state].subHandler.call(this, this._subParser.complete());
      this._subParser = null;
    }

    /**
     * Places a new tree node at the current position of the cursor (to the 'right'
     * property) and then advances the cursor to the new node. This function also
     * handles setting the parent of the new node.
     * @param {{type: <string>}} node A node to be added to the AST
     * @private
     */
    _placeAtCursor(node) {
      if (!this._cursor) {
        this._tree = node;
      } else {
        this._cursor.right = node;
        this._setParent(node, this._cursor);
      }
      this._cursor = node;
    }

    /**
     * Places a tree node before the current position of the cursor, replacing
     * the node that the cursor currently points to. This should only be called in
     * cases where the cursor is known to exist, and the provided node already
     * contains a pointer to what's at the cursor currently.
     * @param {{type: <string>}} node A node to be added to the AST
     * @private
     */
    _placeBeforeCursor(node) {
      this._cursor = this._cursor._parent;
      this._placeAtCursor(node);
    }

    /**
     * Sets the parent of a node by creating a non-enumerable _parent property
     * that points to the supplied parent argument.
     * @param {{type: <string>}} node A node of the AST on which to set a new
     *      parent
     * @param {{type: <string>}} parent An existing node of the AST to serve as the
     *      parent of the new node
     * @private
     */
    _setParent(node, parent) {
      Object.defineProperty(node, '_parent', {
        value: parent,
        writable: true
      });
    }

    /**
     * Prepares the Parser to accept a subexpression by (re)instantiating the
     * subParser.
     * @param {string} [exprStr] The expression string to prefix to the new Parser
     * @private
     */
    _startSubExpression(exprStr) {
      let endStates = states$1[this._state].endStates;
      if (!endStates) {
        this._parentStop = true;
        endStates = this._stopMap;
      }
      this._subParser = new Parser(this._grammar, exprStr, endStates);
    }
  }

  var Parser_1 = Parser;

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */

  class PromiseSync {
    constructor(fn) {
      fn(this._resolve.bind(this), this._reject.bind(this));
    }

    catch(rejected) {
      if (this.error) {
        try {
          this._resolve(rejected(this.error));
        } catch (e) {
          this._reject(e);
        }
      }
      return this
    }

    then(resolved, rejected) {
      if (!this.error) {
        try {
          this._resolve(resolved(this.value));
        } catch (e) {
          this._reject(e);
        }
      }
      if (rejected) this.catch(rejected);
      return this
    }

    _reject(error) {
      this.value = undefined;
      this.error = error;
    }

    _resolve(val) {
      if (val instanceof PromiseSync) {
        if (val.error) {
          this._reject(val.error);
        } else {
          this._resolve(val.value);
        }
      } else {
        this.value = val;
        this.error = undefined;
      }
    }
  }

  PromiseSync.all = vals =>
    new PromiseSync(resolve => {
      const resolved = vals.map(val => {
        while (val instanceof PromiseSync) {
          if (val.error) throw Error(val.error)
          val = val.value;
        }
        return val
      });
      resolve(resolved);
    });

  PromiseSync.resolve = val => new PromiseSync(resolve => resolve(val));

  PromiseSync.reject = error =>
    new PromiseSync((resolve, reject) => reject(error));

  var PromiseSync_1 = PromiseSync;

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */






  class Expression {
    constructor(lang, exprStr) {
      this._lang = lang;
      this._lexer = new Lexer_1(lang.grammar);
      this._exprStr = exprStr;
      this._ast = null;
    }

    /**
     * Forces a compilation of the expression string that this Expression object
     * was constructed with. This function can be called multiple times; useful
     * if the language elements of the associated Jexl instance change.
     * @returns {Expression} this Expression instance, for convenience
     */
    compile() {
      const lexer = new Lexer_1(this._lang.grammar);
      const parser = new Parser_1(this._lang.grammar);
      const tokens = lexer.tokenize(this._exprStr);
      parser.addTokens(tokens);
      this._ast = parser.complete();
      return this
    }

    /**
     * Asynchronously evaluates the expression within an optional context.
     * @param {Object} [context] A mapping of variables to values, which will be
     *      made accessible to the Jexl expression when evaluating it
     * @returns {Promise<*>} resolves with the result of the evaluation.
     */
    eval(context = {}) {
      return this._eval(context, Promise)
    }

    /**
     * Synchronously evaluates the expression within an optional context.
     * @param {Object} [context] A mapping of variables to values, which will be
     *      made accessible to the Jexl expression when evaluating it
     * @returns {*} the result of the evaluation.
     * @throws {*} on error
     */
    evalSync(context = {}) {
      const res = this._eval(context, PromiseSync_1);
      if (res.error) throw res.error
      return res.value
    }

    _eval(context, promise) {
      return promise.resolve().then(() => {
        const ast = this._getAst();
        const evaluator = new Evaluator_1(
          this._lang.grammar,
          this._lang.transforms,
          context,
          undefined,
          promise
        );
        return evaluator.eval(ast)
      })
    }

    _getAst() {
      if (!this._ast) this.compile();
      return this._ast
    }
  }

  var Expression_1 = Expression;

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */

  /* eslint eqeqeq:0 */

  /**
   * A map of all expression elements to their properties. Note that changes
   * here may require changes in the Lexer or Parser.
   * @type {{}}
   */
  var elements = {
    '.': { type: 'dot' },
    '[': { type: 'openBracket' },
    ']': { type: 'closeBracket' },
    '|': { type: 'pipe' },
    '{': { type: 'openCurl' },
    '}': { type: 'closeCurl' },
    ':': { type: 'colon' },
    ',': { type: 'comma' },
    '(': { type: 'openParen' },
    ')': { type: 'closeParen' },
    '?': { type: 'question' },
    '+': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) => left + right
    },
    '-': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) => left - right
    },
    '*': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => left * right
    },
    '/': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => left / right
    },
    '//': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => Math.floor(left / right)
    },
    '%': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => left % right
    },
    '^': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => Math.pow(left, right)
    },
    '==': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left == right
    },
    '!=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left != right
    },
    '>': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left > right
    },
    '>=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left >= right
    },
    '<': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left < right
    },
    '<=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left <= right
    },
    '&&': {
      type: 'binaryOp',
      precedence: 10,
      eval: (left, right) => left && right
    },
    '||': {
      type: 'binaryOp',
      precedence: 10,
      eval: (left, right) => left || right
    },
    in: {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => {
        if (typeof right === 'string') {
          return right.indexOf(left) !== -1
        }
        if (Array.isArray(right)) {
          return right.some(elem => elem === left)
        }
        return false
      }
    },
    '!': {
      type: 'unaryOp',
      precedence: Infinity,
      eval: right => !right
    }
  };

  var grammar = {
  	elements: elements
  };

  /*
   * Jexl
   * Copyright 2019 Tom Shawver
   */


  const defaultGrammar = grammar.elements;

  /**
   * Jexl is the Javascript Expression Language, capable of parsing and
   * evaluating basic to complex expression strings, combined with advanced
   * xpath-like drilldown into native Javascript objects.
   * @constructor
   */
  class Jexl {
    constructor() {
      // Allow expr to be called outside of the jexl context
      this.expr = this.expr.bind(this);
      this._grammar = Object.assign({}, defaultGrammar);
      this._lexer = null;
      this._transforms = {};
    }

    /**
     * Adds a binary operator to Jexl at the specified precedence. The higher the
     * precedence, the earlier the operator is applied in the order of operations.
     * For example, * has a higher precedence than +, because multiplication comes
     * before division.
     *
     * Please see grammar.js for a listing of all default operators and their
     * precedence values in order to choose the appropriate precedence for the
     * new operator.
     * @param {string} operator The operator string to be added
     * @param {number} precedence The operator's precedence
     * @param {function} fn A function to run to calculate the result. The function
     *      will be called with two arguments: left and right, denoting the values
     *      on either side of the operator. It should return either the resulting
     *      value, or a Promise that resolves with the resulting value.
     */
    addBinaryOp(operator, precedence, fn) {
      this._addGrammarElement(operator, {
        type: 'binaryOp',
        precedence: precedence,
        eval: fn
      });
    }

    /**
     * Adds a unary operator to Jexl. Unary operators are currently only supported
     * on the left side of the value on which it will operate.
     * @param {string} operator The operator string to be added
     * @param {function} fn A function to run to calculate the result. The function
     *      will be called with one argument: the literal value to the right of the
     *      operator. It should return either the resulting value, or a Promise
     *      that resolves with the resulting value.
     */
    addUnaryOp(operator, fn) {
      this._addGrammarElement(operator, {
        type: 'unaryOp',
        weight: Infinity,
        eval: fn
      });
    }

    /**
     * Adds or replaces a transform function in this Jexl instance.
     * @param {string} name The name of the transform function, as it will be used
     *      within Jexl expressions
     * @param {function} fn The function to be executed when this transform is
     *      invoked. It will be provided with at least one argument:
     *          - {*} value: The value to be transformed
     *          - {...*} args: The arguments for this transform
     */
    addTransform(name, fn) {
      this._transforms[name] = fn;
    }

    /**
     * Syntactic sugar for calling {@link #addTransform} repeatedly.  This function
     * accepts a map of one or more transform names to their transform function.
     * @param {{}} map A map of transform names to transform functions
     */
    addTransforms(map) {
      for (let key in map) {
        if (map.hasOwnProperty(key)) {
          this._transforms[key] = map[key];
        }
      }
    }

    /**
     * Creates an Expression object from the given Jexl expression string, and
     * immediately compiles it. The returned Expression object can then be
     * evaluated multiple times with new contexts, without generating any
     * additional string processing overhead.
     * @param {string} expression The Jexl expression to be compiled
     * @returns {Expression} The compiled Expression object
     */
    compile(expression) {
      const exprObj = this.createExpression(expression);
      return exprObj.compile()
    }

    /**
     * Constructs an Expression object from a Jexl expression string.
     * @param {string} expression The Jexl expression to be wrapped in an
     *    Expression object
     * @returns {Expression} The Expression object representing the given string
     */
    createExpression(expression) {
      const lang = this._getLang();
      return new Expression_1(lang, expression)
    }

    /**
     * Retrieves a previously set transform function.
     * @param {string} name The name of the transform function
     * @returns {function} The transform function
     */
    getTransform(name) {
      return this._transforms[name]
    }

    /**
     * Asynchronously evaluates a Jexl string within an optional context.
     * @param {string} expression The Jexl expression to be evaluated
     * @param {Object} [context] A mapping of variables to values, which will be
     *      made accessible to the Jexl expression when evaluating it
     * @returns {Promise<*>} resolves with the result of the evaluation.
     */
    eval(expression, context = {}) {
      const exprObj = this.createExpression(expression);
      return exprObj.eval(context)
    }

    /**
     * Synchronously evaluates a Jexl string within an optional context.
     * @param {string} expression The Jexl expression to be evaluated
     * @param {Object} [context] A mapping of variables to values, which will be
     *      made accessible to the Jexl expression when evaluating it
     * @returns {*} the result of the evaluation.
     * @throws {*} on error
     */
    evalSync(expression, context = {}) {
      const exprObj = this.createExpression(expression);
      return exprObj.evalSync(context)
    }

    expr(strs, ...args) {
      const exprStr = strs.reduce((acc, str, idx) => {
        const arg = idx < args.length ? args[idx] : '';
        acc += str + arg;
        return acc
      }, '');
      return this.createExpression(exprStr)
    }

    /**
     * Removes a binary or unary operator from the Jexl grammar.
     * @param {string} operator The operator string to be removed
     */
    removeOp(operator) {
      if (
        this._grammar[operator] &&
        (this._grammar[operator].type === 'binaryOp' ||
          this._grammar[operator].type === 'unaryOp')
      ) {
        delete this._grammar[operator];
      }
    }

    /**
     * Adds an element to the grammar map used by this Jexl instance.
     * @param {string} str The key string to be added
     * @param {{type: <string>}} obj A map of configuration options for this
     *      grammar element
     * @private
     */
    _addGrammarElement(str, obj) {
      this._grammar[str] = obj;
    }

    /**
     * Gets an object defining the dynamic language elements of this Jexl
     * instance.
     * @returns {{ grammar: object, transforms: object }} A language definition
     *    object
     * @private
     */
    _getLang() {
      return {
        grammar: this._grammar,
        transforms: this._transforms
      }
    }
  }

  var Jexl_1 = new Jexl();
  var Jexl_2 = Jexl;
  Jexl_1.Jexl = Jexl_2;

  var main = Jexl_2;

  return main;

})));
//# sourceMappingURL=jexl.js.map
