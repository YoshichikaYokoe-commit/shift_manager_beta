function sendPendingNotifications() {
  const projectId = getProperty_("FIREBASE_PROJECT_ID");
  const accessToken = getAccessToken_();

  const queryUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents:runQuery`;

  const queryBody = {
    structuredQuery: {
      from: [
        {
          collectionId: "notifications"
        }
      ],
      where: {
        fieldFilter: {
          field: {
            fieldPath: "sent"
          },
          op: "EQUAL",
          value: {
            booleanValue: false
          }
        }
      }
    }
  };

  const response = UrlFetchApp.fetch(queryUrl, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    payload: JSON.stringify(queryBody),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    throw new Error(
      `Firestore取得失敗: ${response.getResponseCode()} ${response.getContentText()}`
    );
  }

  const results = JSON.parse(response.getContentText());

  for (const result of results) {
    if (!result.document) continue;

    const document = result.document;
    const fields = document.fields || {};

    const recipientEmail =
      fields.recipientEmail?.stringValue || "";

    const subject =
      fields.subject?.stringValue || "先生どーぞからのお知らせ";

    const body =
      fields.body?.stringValue || "";

    if (!recipientEmail) {
      console.log("recipientEmail がないためスキップ");
      continue;
    }

    try {
      GmailApp.sendEmail(
        recipientEmail,
        subject,
        body,
        {
          name: "センセイドーゾ"
        }
      );

      markNotificationAsSent_(
        document.name,
        accessToken
      );

      console.log(
        `送信成功: ${recipientEmail} / ${subject}`
      );

    } catch (error) {
      console.error(
        `送信失敗: ${recipientEmail}`,
        error
      );
    }
  }
}


/**
 * 授業開始60分以内になった確定済み授業を講師へ通知
 *
 * 5分おきのトリガーで動かす想定。
 * reminder60mSent=true にして二重送信を防ぐ。
 */
function sendLessonReminders() {
  const projectId = getProperty_("FIREBASE_PROJECT_ID");
  const accessToken = getAccessToken_();

  const queryUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents:runQuery`;

  const queryBody = {
    structuredQuery: {
      from: [
        {
          collectionId: "shifts"
        }
      ],
      where: {
        fieldFilter: {
          field: {
            fieldPath: "status"
          },
          op: "EQUAL",
          value: {
            stringValue: "confirmed"
          }
        }
      }
    }
  };

  console.log("=== 授業リマインド確認開始 ===");

  const response = UrlFetchApp.fetch(queryUrl, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    payload: JSON.stringify(queryBody),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    throw new Error(
      `授業取得失敗: ${response.getResponseCode()} ${response.getContentText()}`
    );
  }

  const results =
    JSON.parse(response.getContentText());

  const now = new Date();

  // 日本時間の今日
  const today =
    Utilities.formatDate(
      now,
      "Asia/Tokyo",
      "yyyy-MM-dd"
    );

  // 日本時間の現在時刻
  const currentHour =
    Number(
      Utilities.formatDate(
        now,
        "Asia/Tokyo",
        "H"
      )
    );

  const currentMinute =
    Number(
      Utilities.formatDate(
        now,
        "Asia/Tokyo",
        "m"
      )
    );

  const currentMinutes =
    currentHour * 60 + currentMinute;

  // 明日の日付
  const tomorrowDate = new Date(now);
  tomorrowDate.setTime(
    tomorrowDate.getTime() + 24 * 60 * 60 * 1000
  );

  const tomorrow =
    Utilities.formatDate(
      tomorrowDate,
      "Asia/Tokyo",
      "yyyy-MM-dd"
    );

  for (const result of results) {
    if (!result.document) continue;

    const document = result.document;
    const fields = document.fields || {};

    const shiftId =
      document.name.split("/").pop();

    const date =
      fields.date?.stringValue || "";

    const startTime =
      fields.startTime?.stringValue || "";

    const endTime =
      fields.endTime?.stringValue || "";

    const teacherId =
      fields.teacherId?.stringValue || "";

    if (!date || !startTime || !teacherId) {
      continue;
    }

    const lessonStart =
      new Date(
        `${date}T${startTime}:00+09:00`
      );

    if (
      Number.isNaN(
        lessonStart.getTime()
      )
    ) {
      continue;
    }

    // すでに授業開始済みなら何も送らない
    if (lessonStart <= now) {
      continue;
    }

    const diffMinutes =
      (
        lessonStart.getTime() -
        now.getTime()
      ) / 60000;

    let teacher;

    try {
      teacher =
        getTeacher_(
          teacherId,
          accessToken
        );
    } catch (error) {
      console.error(
        `講師取得失敗: ${teacherId}`,
        error
      );
      continue;
    }

    if (!teacher || !teacher.email) {
      console.log(
        `講師メールなし: ${teacherId}`
      );
      continue;
    }

    const teacherName =
      fields.teacherName?.stringValue ||
      teacher.name ||
      "講師";

    const studentName =
      fields.studentName?.stringValue ||
      "生徒";

    const subjectName =
      fields.subjectName?.stringValue ||
      "未設定";


    // ========================================
    // ① 前日18:00
    // ========================================

    const previousDaySent =
      fields.reminderPreviousDaySent
        ?.booleanValue === true;

    if (
      date === tomorrow &&
      currentMinutes >= 18 * 60 &&
      !previousDaySent
    ) {

      const subject =
        "【センセイドーゾ】明日の授業のお知らせ";

      const body =
`${teacherName} 先生

明日の授業予定をお知らせします。

━━━━━━━━━━━━━━
生徒：${studentName}
日付：${formatDateJa_(date)}
時間：${startTime}〜${endTime}
教科：${subjectName}
━━━━━━━━━━━━━━

授業予定をご確認ください。

センセイドーゾ`;

      try {
        GmailApp.sendEmail(
          teacher.email,
          subject,
          body,
          {
            name: "センセイドーゾ"
          }
        );

        markShiftReminderSent_(
          document.name,
          accessToken,
          "reminderPreviousDaySent",
          "reminderPreviousDaySentAt"
        );

        console.log(
          `前日18時リマインド送信成功: ${shiftId}`
        );

      } catch (error) {
        console.error(
          "前日リマインド送信失敗",
          error
        );
      }
    }


    // ========================================
    // ② 当日10:00
    // ========================================

    const reminder10amSent =
      fields.reminder10amSent
        ?.booleanValue === true;

    if (
      date === today &&
      currentMinutes >= 10 * 60 &&
      !reminder10amSent
    ) {

      const subject =
        "【センセイドーゾ】本日の授業のお知らせ";

      const body =
`${teacherName} 先生

本日の授業予定をお知らせします。

━━━━━━━━━━━━━━
生徒：${studentName}
日付：${formatDateJa_(date)}
時間：${startTime}〜${endTime}
教科：${subjectName}
━━━━━━━━━━━━━━

授業予定をご確認ください。

センセイドーゾ`;

      try {
        GmailApp.sendEmail(
          teacher.email,
          subject,
          body,
          {
            name: "センセイドーゾ"
          }
        );

        markShiftReminderSent_(
          document.name,
          accessToken,
          "reminder10amSent",
          "reminder10amSentAt"
        );

        console.log(
          `当日10時リマインド送信成功: ${shiftId}`
        );

      } catch (error) {
        console.error(
          "当日10時リマインド送信失敗",
          error
        );
      }
    }


    // ========================================
    // ③ 授業開始60分以内
    // ========================================

    const reminder60mSent =
      fields.reminder60mSent
        ?.booleanValue === true;

    if (
      diffMinutes > 0 &&
      diffMinutes <= 60 &&
      !reminder60mSent
    ) {

      const subject =
        "【センセイドーゾ】まもなく授業があります";

      const body =
`${teacherName} 先生

まもなく授業があります。

━━━━━━━━━━━━━━
生徒：${studentName}
日付：${formatDateJa_(date)}
時間：${startTime}〜${endTime}
教科：${subjectName}
━━━━━━━━━━━━━━

授業予定をご確認ください。

センセイドーゾ`;

      try {
        GmailApp.sendEmail(
          teacher.email,
          subject,
          body,
          {
            name: "センセイドーゾ"
          }
        );

        markShiftReminderSent_(
          document.name,
          accessToken,
          "reminder60mSent",
          "reminder60mSentAt"
        );

        console.log(
          `1時間前リマインド送信成功: ${shiftId}`
        );

      } catch (error) {
        console.error(
          "1時間前リマインド送信失敗",
          error
        );
      }
    }
  }

  console.log("=== 授業リマインド確認終了 ===");
}