/**
 * ZoomSdkTracker - Utility for tracking user data during Zoom meetings
 * 
 * This module provides functions to track Zoom meeting participants
 * and record their data (name, email, etc.) in the database.
 */

const ZoomMeeting = require('../models/ZoomMeeting');
const Student = require('../models/Student');

/**
 * Track a participant joining a Zoom meeting
 * @param {Object} participantData - Information about the participant
 * @param {String} participantData.meetingId - The ID of the Zoom meeting
 * @param {String} participantData.name - The participant's name
 * @param {String} participantData.email - The participant's email
 * @param {String} participantData.userId - The participant's unique ID
 * @param {Date} participantData.joinTime - When the participant joined
 * @returns {Promise<Object>} The updated meeting document
 */
const trackParticipantJoin = async (participantData) => {
  try {
    const { meetingId, name, email, userId, joinTime = new Date() } = participantData;
    
    if (!meetingId) {
      throw new Error('Meeting ID is required to track participant');
    }
    
    // Find the meeting in our database
    let meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
    
    if (!meeting) {
      console.warn(`Meeting ${meetingId} not found in database, cannot track participant`);
      return null;
    }
    
    // Prepare participant data
    const participantInfo = {
      participantId: userId || `user-${Date.now()}`,
      name: name || 'Anonymous',
      email: email || null,
      joinTime: joinTime,
      status: 'joined',
      recordingConsent: participantData.recordingConsent || false
    };
    
    // If there's a student record with this email, link it
    if (email) {
      try {
        const student = await Student.findOne({ 
          $or: [
            { Email: email.toLowerCase() },
            { Email: email }
          ] 
        });
        
        if (student) {
          // Link to existing student
          participantInfo.studentId = student.StudentID;
          participantInfo.studentFirstName = student.FirstName;
          participantInfo.studentLastName = student.LastName;
          participantInfo.studentDepartment = student.Department;
          participantInfo.studentEmail = student.Email;
          participantInfo.isMatched = true;
          
          console.log(`✅ Matched Zoom participant ${name} with existing student ${student.FirstName} ${student.LastName}`);
        } else if (email && name) {
          // Auto-create student record from Zoom participant data
          try {
            // Generate a unique StudentID (using timestamp + random number)
            const generateStudentId = () => {
              const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
              const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
              return parseInt(`${timestamp}${random}`);
            };
            
            let studentId = generateStudentId();
            
            // Ensure StudentID is unique
            while (await Student.findOne({ StudentID: studentId })) {
              studentId = generateStudentId();
            }
            
            // Parse name into first and last name
            const nameParts = name.trim().split(' ');
            const firstName = nameParts[0];
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'N/A';
            
            // Create new student record
            const newStudent = new Student({
              StudentID: studentId,
              FirstName: firstName,
              LastName: lastName,
              Email: email,
              PhoneNumber: '0000000000', // Default phone number
              DateOfBirth: new Date('2000-01-01'), // Default date of birth
              Gender: 'Other', // Default gender
              Department: 'Faculty', // Default department
              TimeIn: new Date(), // Current time as TimeIn
              TimeOut: null // No TimeOut initially
            });
            
            await newStudent.save();
            
            // Link the new student to the participant
            participantInfo.studentId = newStudent.StudentID;
            participantInfo.studentFirstName = newStudent.FirstName;
            participantInfo.studentLastName = newStudent.LastName;
            participantInfo.studentDepartment = newStudent.Department;
            participantInfo.studentEmail = newStudent.Email;
            participantInfo.isMatched = true;
            
            console.log(`🆕 Auto-created new student record: ${firstName} ${lastName} (${email}) with ID ${studentId}`);
            
          } catch (createError) {
            console.error('Error creating student from Zoom participant:', createError);
            // If creation fails, continue without matching
            participantInfo.isMatched = false;
          }
        } else {
          console.log(`⚠️ No student record found for ${name || 'Anonymous'} (${email || 'no email'}) - proceeding without match`);
        }
      } catch (studentError) {
        console.error('Error matching/creating student record:', studentError);
      }
    }
    
    // Update meeting with participant data
    await meeting.updateParticipant(participantInfo);
    console.log(`Tracked participant join: ${name} (${email || 'no email'}) to meeting ${meetingId}`);
    
    return meeting;
  } catch (error) {
    console.error('Error tracking participant join:', error);
    throw error;
  }
};

/**
 * Track a participant leaving a Zoom meeting
 * @param {Object} participantData - Information about the participant
 * @param {String} participantData.meetingId - The ID of the Zoom meeting
 * @param {String} participantData.userId - The participant's unique ID
 * @param {String} participantData.email - The participant's email (optional)
 * @param {Date} participantData.leaveTime - When the participant left
 * @returns {Promise<Object>} The updated meeting document
 */
const trackParticipantLeave = async (participantData) => {
  try {
    const { meetingId, userId, email, leaveTime = new Date() } = participantData;
    
    if (!meetingId) {
      throw new Error('Meeting ID is required to track participant leave');
    }
    
    // Find the meeting in our database
    let meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
    
    if (!meeting) {
      console.warn(`Meeting ${meetingId} not found in database, cannot track participant leave`);
      return null;
    }
    
    // Find the participant in the meeting
    const existingParticipantIndex = meeting.participants.findIndex(p => 
      (userId && p.participantId === userId) || 
      (email && p.email === email)
    );
    
    if (existingParticipantIndex === -1) {
      console.warn(`Participant not found in meeting ${meetingId}`);
      return meeting;
    }
    
    // Update participant data
    const participant = meeting.participants[existingParticipantIndex];
    participant.leaveTime = leaveTime;
    participant.status = 'left';
    
    // Calculate duration if both join and leave times exist
    if (participant.joinTime) {
      const joinTime = new Date(participant.joinTime);
      const leaveTimeObj = new Date(leaveTime);
      
      // Calculate duration in seconds
      const durationMs = leaveTimeObj - joinTime;
      participant.duration = Math.floor(durationMs / 1000);
    }
    
    await meeting.save();
    console.log(`Tracked participant leave: ${participant.name} from meeting ${meetingId}`);
    
    return meeting;
  } catch (error) {
    console.error('Error tracking participant leave:', error);
    throw error;
  }
};

/**
 * Store meeting details when a Zoom meeting is created via SDK
 * @param {Object} meetingData - Information about the meeting
 * @returns {Promise<Object>} The created meeting document
 */
const storeZoomMeetingDetails = async (meetingData) => {
  try {
    const {
      id: meetingId,
      uuid: meetingUuid,
      topic,
      host_id: hostId,
      host_email: hostEmail,
      type,
      start_time: startTime,
      duration,
      timezone,
      password,
      join_url: joinUrl,
      start_url: startUrl,
      settings,
      metadata
    } = meetingData;
    
    // Check if meeting already exists
    let meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
    
    if (meeting) {
      // Update existing meeting
      meeting.meetingUuid = meetingUuid;
      meeting.topic = topic;
      meeting.type = type;
      meeting.startTime = startTime ? new Date(startTime) : new Date();
      meeting.duration = duration || meeting.duration || 60; // Keep existing duration if not provided, default to 60
      meeting.timezone = timezone || meeting.timezone || 'UTC';
      meeting.password = password;
      meeting.joinUrl = joinUrl;
      meeting.startUrl = startUrl;
      
      if (settings) {
        meeting.settings = {
          hostVideo: settings.host_video,
          participantVideo: settings.participant_video,
          joinBeforeHost: settings.join_before_host,
          muteUponEntry: settings.mute_upon_entry,
          waitingRoom: settings.waiting_room,
          autoRecording: settings.auto_recording || 'none',
          approvalType: settings.approval_type || 0
        };
      }
      
      if (metadata) {
        meeting.metadata = {
          createdBy: metadata.createdBy || metadata.created_by,
          tags: metadata.tags || [],
          department: metadata.department,
          course: metadata.course,
          session: metadata.session
        };
      }
    } else {
      // Create new meeting
      meeting = new ZoomMeeting({
        meetingId: meetingId.toString(),
        meetingUuid: meetingUuid,
        topic: topic,
        hostId: hostId,
        hostEmail: hostEmail,
        type: type,
        startTime: startTime ? new Date(startTime) : new Date(),
        duration: duration || 60, // Default to 60 minutes if duration is not provided
        timezone: timezone || 'UTC',
        password: password,
        joinUrl: joinUrl,
        startUrl: startUrl,
        status: 'waiting',
        settings: {
          hostVideo: settings?.host_video,
          participantVideo: settings?.participant_video,
          joinBeforeHost: settings?.join_before_host,
          muteUponEntry: settings?.mute_upon_entry,
          waitingRoom: settings?.waiting_room,
          autoRecording: settings?.auto_recording || 'none',
          approvalType: settings?.approval_type || 0
        },
        metadata: {
          createdBy: metadata?.createdBy || metadata?.created_by || hostEmail,
          tags: metadata?.tags || [],
          department: metadata?.department,
          course: metadata?.course,
          session: metadata?.session
        }
      });
    }
    
    await meeting.save();
    console.log(`Stored meeting details for meeting ${meetingId}`);
    
    return meeting;
  } catch (error) {
    console.error('Error storing meeting details:', error);
    throw error;
  }
};

module.exports = {
  trackParticipantJoin,
  trackParticipantLeave,
  storeZoomMeetingDetails
};
