'use strict';
let config = require('./config');

/**
 * List the lambdas that match the specified filter
 * @param filter string pattern to match
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
function listFunctions(filter, continuationToken) {
  return new Promise((resolve, reject) => {
    let lambda = new config.AWS.Lambda();
    let params = {
      Marker: continuationToken
    };

   lambda.listFunctions(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        if (data && data.Functions) {
          data.Functions = data.Functions.filter(lambda => lambda.FunctionName.includes(filter))
        }
        resolve(data);
      }
    });
  });
}


/**
 * Update the code for the specified lambda
 * @param params AWS updateFunctionCode params
 * @return {Promise}
 */
function updateFunctionCode(params) {
  return new Promise((resolve, reject) => {
    let lambda = new config.AWS.Lambda();
    lambda.updateFunctionCode(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        config.logger.info('Updated Lambda function: ', params.FunctionName);
        resolve(data);
      }
    });
  });
}


/**
 * Update the code for all the functions that match the specified filter
 * @param filter string pattern to match
 * @param params AWS updateFunctionCode params (note: FunctionName should not be specified)
 */
function updateFunctionsCode(filter, params) {
  return new Promise((resolve, reject) => {

    let listAndUpdate = function(continuationToken) {
      return new Promise((resolve, reject) => {
        listFunctions(filter, continuationToken)
          .then(data => {
            if (data && data.Functions && data.Functions.length > 0) {
              Promise.all(
                data.Functions.map((lambda) =>
                  new Promise((resolve) => resolve(updateFunctionCode(
                    Object.assign({}, params, { FunctionName: lambda.FunctionName}))))
                ))
                .then(() => resolve(data.NextMarker))
                .catch(err => reject(err));
            } else {
              resolve();
            }
          })
          .catch(err => reject(err));
      })
    };

    listAndUpdate()
      .then(continuationToken => {
        if (continuationToken) {
          return (listAndUpdate(continuationToken))
        }
      })
      .then(() => resolve())
      .catch(err => reject(err));
  });
}


/**
 * Invoke the specified lambda
 * @param name function name
 * @param input input json
 * @param context [optional] client context details
 * @return {Promise}
 */
function invokeFunction(name, input, context) {
  return new Promise((resolve, reject) => {
    let params = {
      FunctionName: name,
      Payload: typeof input !== 'string' ? JSON.stringify(input) : input,
      ClientContext: context
    };
    let lambda = new config.AWS.Lambda();
    config.logger.info('Invoking Lambda function:', params.FunctionName);
    lambda.invoke(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
        config.logger.info('Result (Status Code:', data.StatusCode,'):');
        config.logger.info({ Payload: JSON.parse(data.Payload)});
      }
    });
  });
}



module.exports = {
  listFunctions,
  invokeFunction,
  updateFunctionCode,
  updateFunctionsCode
};
