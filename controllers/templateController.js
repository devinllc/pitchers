const { v4: uuidv4 } = require('uuid');
const CampaignTemplate = require('../models/CampaignTemplate');
const DatabaseService = require('../services/database');

const databaseService = new DatabaseService();
const templateModel = new CampaignTemplate(databaseService);

function getUserEmail(req) {
  return req.apiKey?.data?.user_email
    || req.headers['x-user-email']
    || req.query.userEmail
    || req.body?.userEmail
    || req.body?.user_email
    || null;
}

function normalizeVariables(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [String(value)];
}

function normalizeMetadata(metadata = {}, subject = '') {
  const normalized = typeof metadata === 'object' && metadata !== null ? { ...metadata } : {};

  if (subject) {
    normalized.subject = subject;
  }

  return normalized;
}

async function listTemplates(req, res) {
  try {
    const userEmail = getUserEmail(req);
    const { channel } = req.query;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'userEmail is required'
      });
    }

    const templates = channel
      ? await templateModel.getTemplatesByChannel(channel, userEmail)
      : await templateModel.getUserTemplates(userEmail);

    return res.json({
      success: true,
      templates,
      count: templates.length,
      channel: channel || null
    });
  } catch (error) {
    console.error('Error listing templates:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list templates'
    });
  }
}

async function getTemplate(req, res) {
  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: 'templateId is required'
      });
    }

    const template = await templateModel.getTemplateById(templateId);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    return res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Error getting template:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch template'
    });
  }
}

async function createTemplate(req, res) {
  try {
    const userEmail = getUserEmail(req);
    const {
      templateName,
      channel,
      templateText,
      subject = '',
      variables = [],
      metadata = {},
      isPreset = false
    } = req.body;

    if (!userEmail || !templateName || !channel || !templateText) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userEmail, templateName, channel, templateText'
      });
    }

    const templateId = `tmpl_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const template = await templateModel.createTemplate({
      templateId,
      userEmail,
      templateName,
      channel,
      templateText,
      isPreset,
      variables: normalizeVariables(variables),
      metadata: normalizeMetadata(metadata, subject)
    });

    return res.status(201).json({
      success: true,
      message: 'Template created successfully',
      template
    });
  } catch (error) {
    console.error('Error creating template:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create template'
    });
  }
}

async function updateTemplate(req, res) {
  try {
    const userEmail = getUserEmail(req);
    const { templateId } = req.params;
    const { templateName, templateText, variables, metadata = {}, subject = '' } = req.body;

    if (!userEmail || !templateId) {
      return res.status(400).json({
        success: false,
        error: 'userEmail and templateId are required'
      });
    }

    const existing = await templateModel.getTemplateById(templateId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    if (existing.user_email && existing.user_email !== userEmail) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to update this template'
      });
    }

    const updates = {
      templateName,
      templateText,
      variables: variables !== undefined ? normalizeVariables(variables) : undefined,
      metadata: normalizeMetadata(metadata, subject)
    };

    const template = await templateModel.updateTemplate(templateId, updates);

    return res.json({
      success: true,
      message: 'Template updated successfully',
      template
    });
  } catch (error) {
    console.error('Error updating template:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update template'
    });
  }
}

async function deleteTemplate(req, res) {
  try {
    const userEmail = getUserEmail(req);
    const { templateId } = req.params;

    if (!userEmail || !templateId) {
      return res.status(400).json({
        success: false,
        error: 'userEmail and templateId are required'
      });
    }

    const existing = await templateModel.getTemplateById(templateId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    if (existing.user_email && existing.user_email !== userEmail) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to delete this template'
      });
    }

    await templateModel.deleteTemplate(templateId);

    return res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete template'
    });
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
};
