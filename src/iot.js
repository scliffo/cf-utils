'use strict';
let config = require('./config');


/**
 * Updates the iot policies that match the naming convention
 * The output policy name key (with the updates) must be suffixed with 'IoTPolicyTemplate'
 * The output policy name key (to be updated) must have the same name as the policy with the updates with 'Template' removed (so suffixed with 'IoTPolicy')
 * @param {Object} stackOutput output variables of a stack
 */
function updateIoTPolicies(stackOutput){
  let promises = [];
  const iot = new config.AWS.Iot();
  Object.keys(stackOutput).forEach(outputKey => {
    if(outputKey.includes('IoTPolicyTemplate')){
      promises.push(
        iot.getPolicy({policyName: stackOutput[outputKey]}).promise().then((newPolicy) => {
          let policyToUpdate = stackOutput[outputKey.replace('Template', '')];
          _removeOldPolicyVersions(policyToUpdate, iot).then(() => {
            iot.createPolicyVersion({policyName: policyToUpdate, policyDocument: newPolicy.policyDocument, setAsDefault: true}).promise()
          })
        })
      );
    };
  });
  return Promise.all(promises)
}
/**
 * Removes all non-default policy versions from iot policy. IoT policies can only have a max of 5 policy versions
 * @param {String} policyName name of the iot policy
 * @param {Object} iot instance of AWS.IoT() to use
 */
function _removeOldPolicyVersions(policyName, iot){
  return iot.listPolicyVersions({policyName: policyName}).promise().then((policies) => {
    if(policies.policyVersions.length > 1){
      let promises = [];
      policies.policyVersions.forEach(policyVersion => {
        if(!policyVersion.isDefaultVersion){
          promises.push(iot.deletePolicyVersion({policyName: policyName, policyVersionId: policyVersion.versionId}).promise());
        };
      })
      return Promise.all(promises)
    }
    else {
      return Promise.resolve()
    };
  });
};


module.exports = {
  updateIoTPolicies
};
